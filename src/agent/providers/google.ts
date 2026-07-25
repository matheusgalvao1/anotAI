import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";
import {
  FetchLike,
  FetchLikeResponse,
  httpErrorKind,
  readErrorMessage,
  readSseEvents,
  resolveFetch,
  sseData,
  toTransportError,
} from "./transport";

const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GoogleProviderOptions = {
  apiKey: string;
  model: string;
  /** See OpenRouterProviderOptions — must be `expo/fetch` in the app. */
  fetch?: FetchLike;
};

/**
 * Google's Gemini API. The furthest of the three from OpenAI's shape:
 *
 * - Messages are `contents` with roles `user` / **`model`** (not `assistant`).
 * - The system prompt is `systemInstruction`, a separate field.
 * - Tools are declared as `functionDeclarations`, and calls/results come back as
 *   `functionCall` / `functionResponse` **parts** inside a content.
 * - **Function results are keyed by name, not by id** — Gemini has no tool-call
 *   ids at all. The canonical format does, so ids are mapped back to names on the
 *   way out (see `toGoogleContents`) and synthesised on the way in.
 * - The model name goes in the URL path, not the body.
 *
 * The key travels in the `x-goog-api-key` header rather than the `?key=` query
 * parameter Google's docs favour, so it can't end up in a URL that gets logged.
 */
export class GoogleProvider implements Provider {
  readonly id = "google";

  constructor(private opts: GoogleProviderOptions) {}

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toGoogleContents(req.messages),
      ...(req.tools.length > 0 ? { tools: [{ functionDeclarations: req.tools.map(toGoogleTool) }] } : {}),
    };

    const doFetch = resolveFetch(this.opts.fetch);
    if (!doFetch) {
      yield {
        type: "error",
        error: { kind: "network", message: "No fetch implementation available. Pass one via the provider options." },
      };
      return;
    }

    // `alt=sse` is what makes this a real SSE stream; without it Gemini returns a
    // JSON array that only completes at the end, which defeats streaming.
    const url = `${GOOGLE_BASE}/${encodeURIComponent(this.opts.model)}:streamGenerateContent?alt=sse`;

    let response: FetchLikeResponse;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
      return;
    }

    if (!response.ok) {
      const message = await readErrorMessage(response, `Google request failed (HTTP ${response.status}).`);
      yield { type: "error", error: { kind: httpErrorKind(response.status), message, status: response.status } };
      return;
    }

    if (!response.body) {
      yield {
        type: "error",
        error: {
          kind: "network",
          message:
            "The fetch implementation in use does not expose a streaming response body, so the model's reply cannot be read. Pass expo/fetch to the provider.",
        },
      };
      return;
    }

    try {
      yield* parseGoogleStream(response.body);
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
    }
  }
}

async function* parseGoogleStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
  let callIndex = 0;

  for await (const event of readSseEvents(stream)) {
    const data = sseData(event);
    if (data === null) continue;

    let parsed: GoogleChunk;
    try {
      parsed = JSON.parse(data) as GoogleChunk;
    } catch {
      continue; // a malformed chunk isn't worth failing the turn over
    }

    const usage = parsed.usageMetadata;
    if (usage) {
      const inputTokens = Number(usage.promptTokenCount ?? 0);
      const outputTokens = Number(usage.candidatesTokenCount ?? 0);
      if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) && inputTokens + outputTokens > 0) {
        yield { type: "usage", inputTokens, outputTokens };
      }
    }

    const parts = parsed.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        yield { type: "text", delta: part.text };
      }

      const call = part?.functionCall;
      if (call && typeof call.name === "string" && call.name.length > 0) {
        // Gemini sends complete function calls in one part — no fragment
        // accumulation — but supplies no id, so one is synthesised. The loop
        // needs an id to correlate the result, and it only has to be unique
        // within this turn.
        yield {
          type: "toolCall",
          call: {
            id: `${call.name}-${callIndex++}`,
            name: call.name,
            arguments: isPlainObject(call.args) ? call.args : {},
          } satisfies ToolCall,
        };
      }
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Canonical messages → Gemini `contents`.
 *
 * Two shape mismatches to bridge. The assistant role is called `model`. And a
 * tool result must name the function it answers, because Gemini correlates by
 * name rather than by id — so this walks back through the preceding assistant
 * tool calls to recover the name for a given `toolCallId`.
 */
function toGoogleContents(messages: CanonicalMessage[]): unknown[] {
  const nameByCallId = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && "toolCalls" in m) {
      for (const call of m.toolCalls) nameByCallId.set(call.id, call.name);
    }
  }

  const out: { role: "user" | "model"; parts: unknown[] }[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      const part = {
        functionResponse: {
          name: nameByCallId.get(m.toolCallId) ?? m.toolCallId,
          response: { result: m.content },
        },
      };
      // Merged into a preceding user content for the same reason as Anthropic:
      // alternating roles are expected, and each result is not its own turn.
      const last = out[out.length - 1];
      if (last?.role === "user") last.parts.push(part);
      else out.push({ role: "user", parts: [part] });
      continue;
    }

    if (m.role === "assistant" && "toolCalls" in m) {
      out.push({
        role: "model",
        parts: m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.arguments } })),
      });
      continue;
    }

    out.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: (m as { content: string }).content }] });
  }

  return out;
}

function toGoogleTool(tool: ToolSchema): unknown {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

type GoogleChunk = {
  candidates?: {
    content?: { parts?: { text?: unknown; functionCall?: { name?: unknown; args?: unknown } }[] };
  }[];
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
};
