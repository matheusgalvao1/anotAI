import { CanonicalMessage, Provider, ProviderError, ProviderRequest, ProviderStreamEvent, ToolSchema } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * The subset of `fetch` this adapter needs, kept structural on purpose: it has
 * to accept the platform `fetch`, `expo/fetch` (whose `Response` is its own
 * class, not the DOM one), and a plain stub in tests — without the agent core
 * importing anything platform-specific to describe them.
 */
export type FetchLikeInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchLikeResponse = {
  ok: boolean;
  status: number;
  /** Null whenever the implementation can't stream, which this adapter reports rather than hiding. */
  body: ReadableStream<Uint8Array> | null;
  json: () => Promise<unknown>;
};

export type FetchLike = (url: string, init?: FetchLikeInit) => Promise<FetchLikeResponse>;

export type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
  /** Sent as HTTP-Referer / X-Title per OpenRouter's attribution convention. No user identifiers. */
  referer?: string;
  title?: string;
  /**
   * Streaming-capable fetch. **The app must pass `expo/fetch` explicitly**
   * (PRD §10 tech stack) — do not rely on the ambient global. React Native's
   * own `fetch` is `whatwg-fetch` over XHR and its `Response` has no `body`
   * property at all, so SSE cannot be read from it. Expo SDK 57 happens to
   * replace `globalThis.fetch` with its streaming implementation, but that is
   * an implicit side effect gated on `EXPO_PUBLIC_USE_RN_FETCH`, and this
   * module is framework-free and may run outside the Expo runtime. Defaults to
   * `globalThis.fetch` only as a convenience for Node-side tests.
   */
  fetch?: FetchLike;
};

/**
 * Translates the canonical agent-loop format to/from OpenRouter's OpenAI-
 * shaped chat completions API. This is the only provider implementation in
 * v1; adding OpenAI/Anthropic/Google (PRD §14.1) means adding sibling files
 * that implement the same Provider interface, not touching the loop.
 */
export class OpenRouterProvider implements Provider {
  readonly id = "openrouter";

  constructor(private opts: OpenRouterProviderOptions) {}

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      model: this.opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toOpenAiMessages(req.system, req.messages),
      ...(req.tools.length > 0 ? { tools: req.tools.map(toOpenAiTool) } : {}),
    };

    const doFetch = this.opts.fetch ?? (typeof globalThis.fetch === "function" ? globalThis.fetch : undefined);
    if (!doFetch) {
      yield {
        type: "error",
        error: { kind: "network", message: "No fetch implementation available. Pass one via OpenRouterProviderOptions." },
      };
      return;
    }

    let response: FetchLikeResponse;
    try {
      response = await doFetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
          ...(this.opts.referer ? { "HTTP-Referer": this.opts.referer } : {}),
          ...(this.opts.title ? { "X-Title": this.opts.title } : {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield { type: "error", error: toNetworkError(err) };
      return;
    }

    if (!response.ok) {
      yield { type: "error", error: await toHttpError(response) };
      return;
    }

    // A successful response with no readable body means the fetch in use can't
    // stream — reporting that as an HTTP error would have blamed OpenRouter for
    // a local wiring problem ("request failed (HTTP 200)").
    if (!response.body) {
      yield {
        type: "error",
        error: {
          kind: "network",
          message:
            "The fetch implementation in use does not expose a streaming response body, so the model's reply cannot be read. Pass expo/fetch to OpenRouterProvider.",
        },
      };
      return;
    }

    yield* parseSse(response.body);
  }
}

function toOpenAiMessages(system: string, messages: CanonicalMessage[]): unknown[] {
  const out: unknown[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && "toolCalls" in m) {
      out.push({
        role: "assistant",
        content: null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      out.push({ role: m.role, content: (m as { content: string }).content });
    }
  }

  return out;
}

function toOpenAiTool(t: ToolSchema): unknown {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
}

async function toHttpError(response: FetchLikeResponse): Promise<ProviderError> {
  let message = `OpenRouter request failed (HTTP ${response.status}).`;
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    if (json?.error?.message) message = json.error.message;
  } catch {
    // response body wasn't JSON — keep the generic message
  }

  const kind: ProviderError["kind"] =
    response.status === 401
      ? "auth"
      : response.status === 402
        ? "insufficient_credits"
        : response.status === 429
          ? "rate_limit"
          : response.status === 404
            ? "not_found"
            : "unknown";

  return { kind, message, status: response.status };
}

function toNetworkError(err: unknown): ProviderError {
  // An adapter can't know *why* the signal fired — a user tapping cancel and a
  // deadline elapsing look identical here. Report the neutral fact and let the
  // caller, which owns the abort reason, decide how to describe it.
  if (err instanceof Error && err.name === "AbortError") {
    return { kind: "cancelled", message: "The request was cancelled." };
  }
  return { kind: "network", message: err instanceof Error ? err.message : "Network request failed." };
}

type ToolCallBuffer = { id: string; name: string; args: string };

/** Matches an SSE event separator: a blank line, in either LF or CRLF form. */
const EVENT_SEPARATOR = /\r?\n\r?\n/;

function splitFirstEvent(buffer: string): { event: string; rest: string } | null {
  const match = EVENT_SEPARATOR.exec(buffer);
  if (!match) return null;
  return { event: buffer.slice(0, match.index), rest: buffer.slice(match.index + match[0].length) };
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const toolCallBuffers = new Map<number, ToolCallBuffer>();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = splitFirstEvent(buffer);
      while (split) {
        buffer = split.rest;
        yield* parseSseEvent(split.event, toolCallBuffers);
        split = splitFirstEvent(buffer);
      }
    }

    // A stream that ends without a trailing blank line still has one real event
    // left in the buffer. Dropping it loses the model's last text delta — or a
    // whole tool call.
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      yield* parseSseEvent(buffer, toolCallBuffers);
    }

    // Not every provider behind OpenRouter closes a tool call with
    // `finish_reason: "tool_calls"` — some send "stop", some send no
    // finish_reason at all before ending the stream. Anything still buffered
    // here is a complete tool call that just never got its terminator, and
    // silently discarding it makes the agent look like it ignored the user.
    yield* flushToolCalls(toolCallBuffers);
  } finally {
    reader.releaseLock();
  }
}

function* flushToolCalls(buffers: Map<number, ToolCallBuffer>): Generator<ProviderStreamEvent> {
  for (const buf of buffers.values()) {
    // A call with no name was never usable — the loop would reject it as an
    // unknown tool, which is noise rather than signal.
    if (!buf.name) continue;
    yield { type: "toolCall", call: { id: buf.id, name: buf.name, arguments: safeParseJson(buf.args) } };
  }
  buffers.clear();
}

function* parseSseEvent(raw: string, buffers: Map<number, ToolCallBuffer>): Generator<ProviderStreamEvent> {
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]" || data.length === 0) continue;

    let json: {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: Array<{
        delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
        finish_reason?: string;
      }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }

    if (json.usage) {
      yield { type: "usage", inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
    }

    const choice = json.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta ?? {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text", delta: delta.content };
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = buffers.get(idx) ?? { id: "", name: "", args: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.args += tc.function.arguments;
        buffers.set(idx, existing);
      }
    }

    // Any terminal finish_reason closes out whatever tool calls have been
    // accumulated. Gating on "tool_calls" alone drops the call entirely on the
    // providers that report "stop" instead.
    if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
      yield* flushToolCalls(buffers);
    }
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
