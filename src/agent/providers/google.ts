import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";
import { FetchLike, openProviderStream, readSseEvents, sseData, toTransportError, usageEvent } from "./transport";

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
 * - **Function results are keyed by name**, so ids are mapped back to names on
 *   the way out (see `toGoogleContents`). Gemini 3 does now send its own call
 *   `id`, but older models send none, so one is still synthesised when absent —
 *   and a synthesised id must never be echoed back as if the model issued it.
 * - **A `functionCall` part carries a `thoughtSignature` that has to be returned
 *   with it**, or the next request fails outright. See `GoogleCallState`.
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

    // `alt=sse` is what makes this a real SSE stream; without it Gemini returns a
    // JSON array that only completes at the end, which defeats streaming.
    const url = `${GOOGLE_BASE}/${encodeURIComponent(this.opts.model)}:streamGenerateContent?alt=sse`;

    const opened = await openProviderStream({
      url,
      displayName: "Google",
      fetch: this.opts.fetch,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    });

    if ("error" in opened) {
      yield { type: "error", error: opened.error };
      return;
    }

    try {
      yield* parseGoogleStream(opened.stream, countToolCalls(req.messages));
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
    }
  }
}

/**
 * How many tool calls this conversation already contains, used to seed the
 * synthesised-id counter.
 *
 * Without it the counter restarted at zero on every request, so a turn that
 * called `read_note` in two iterations produced the id `read_note-0` twice in
 * one history. Gemini itself survives that — it correlates results by function
 * name — but the loop pairs results by id, and a user who switches to OpenAI or
 * Anthropic mid-session then replays a history with duplicate tool-call ids.
 */
function countToolCalls(messages: CanonicalMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.role === "assistant" && "toolCalls" in m) total += m.toolCalls.length;
  }
  return total;
}

async function* parseGoogleStream(
  stream: ReadableStream<Uint8Array>,
  firstCallIndex: number,
): AsyncIterable<ProviderStreamEvent> {
  let callIndex = firstCallIndex;

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
    const usageReport = usage ? usageEvent(usage.promptTokenCount, usage.candidatesTokenCount) : null;
    if (usageReport) yield usageReport;

    const parts = parsed.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.length > 0) {
        yield { type: "text", delta: part.text };
      }

      const call = part?.functionCall;
      if (call && typeof call.name === "string" && call.name.length > 0) {
        // Gemini sends complete function calls in one part — no fragment
        // accumulation — along with a `thoughtSignature` that sits on the *part*,
        // as a sibling of `functionCall` rather than a field inside it.
        const modelCallId = typeof call.id === "string" && call.id.length > 0 ? call.id : undefined;
        const thoughtSignature =
          typeof part.thoughtSignature === "string" && part.thoughtSignature.length > 0
            ? part.thoughtSignature
            : undefined;
        const state: GoogleCallState = { id: modelCallId, thoughtSignature };

        yield {
          type: "toolCall",
          call: {
            // Prefer the model's own id; synthesise only when it sent none. The
            // loop needs an id to correlate the result, and `firstCallIndex`
            // keeps a synthesised one unique across the whole conversation.
            id: modelCallId ?? `${call.name}-${callIndex++}`,
            name: call.name,
            arguments: isPlainObject(call.args) ? call.args : {},
            // Omitted entirely when the model sent neither, rather than carrying
            // `{id: undefined, thoughtSignature: undefined}` into stored history.
            ...(modelCallId || thoughtSignature ? { providerData: state } : {}),
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
 * What Gemini needs handed back with a tool call it already issued, carried on
 * `ToolCall.providerData`.
 *
 * `thoughtSignature` is not optional in practice on Gemini 3: replaying a
 * `functionCall` part without it fails the *next* request with "Function call is
 * missing a thought_signature in functionCall parts", which reads as a model
 * problem rather than a serialisation one. `id` is stored separately from
 * `ToolCall.id` so a synthesised fallback id is never echoed back to Gemini as
 * though the model had issued it.
 */
type GoogleCallState = { id?: string; thoughtSignature?: string };

/**
 * Reads the state back defensively rather than trusting the cast: `providerData`
 * is `unknown` by design, history may have been persisted and rehydrated, and it
 * may have been produced by a different provider entirely if the user switched
 * models mid-session.
 */
function googleCallState(data: unknown): GoogleCallState {
  if (!isPlainObject(data)) return {};
  return {
    id: typeof data.id === "string" && data.id.length > 0 ? data.id : undefined,
    thoughtSignature:
      typeof data.thoughtSignature === "string" && data.thoughtSignature.length > 0 ? data.thoughtSignature : undefined,
  };
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
  const callById = new Map<string, ToolCall>();
  for (const m of messages) {
    if (m.role === "assistant" && "toolCalls" in m) {
      for (const call of m.toolCalls) callById.set(call.id, call);
    }
  }

  const out: GoogleContent[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      const call = callById.get(m.toolCallId);
      const { id } = googleCallState(call?.providerData);
      appendPart(out, "user", {
        functionResponse: {
          name: call?.name ?? m.toolCallId,
          // Only when Gemini issued the id itself — pairing a response with an
          // id the model never sent is worse than sending none.
          ...(id ? { id } : {}),
          response: { result: m.content },
        },
      });
      continue;
    }

    if (m.role === "assistant" && "toolCalls" in m) {
      for (const tc of m.toolCalls) {
        const { id, thoughtSignature } = googleCallState(tc.providerData);
        appendPart(out, "model", {
          functionCall: { name: tc.name, args: tc.arguments, ...(id ? { id } : {}) },
          // Sibling of functionCall, not a field inside it — Gemini rejects the
          // request if this is nested or missing.
          ...(thoughtSignature ? { thoughtSignature } : {}),
        });
      }
      continue;
    }

    appendPart(out, m.role === "assistant" ? "model" : "user", { text: (m as { content: string }).content });
  }

  return out;
}

type GoogleContent = { role: "user" | "model"; parts: unknown[] };

/**
 * Appends a part, merging into the previous content when the role matches.
 *
 * Gemini expects contents to alternate, and the canonical history doesn't
 * guarantee it — a tool result becomes a `user` content, so the next turn's
 * prompt would otherwise open a second one straight after. Same rule as the
 * Anthropic adapter, kept deliberately identical so the two can't drift.
 */
function appendPart(out: GoogleContent[], role: "user" | "model", part: unknown): void {
  const last = out[out.length - 1];
  if (last?.role === role) last.parts.push(part);
  else out.push({ role, parts: [part] });
}

function toGoogleTool(tool: ToolSchema): unknown {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

type GoogleChunk = {
  candidates?: {
    content?: {
      parts?: {
        text?: unknown;
        /** Sibling of `functionCall`, not nested inside it. */
        thoughtSignature?: unknown;
        functionCall?: { name?: unknown; args?: unknown; id?: unknown };
      }[];
    };
  }[];
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
};
