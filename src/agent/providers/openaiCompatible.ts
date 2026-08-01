import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";
import { FetchLike, openProviderStream, readSseEvents, sseData, toTransportError, usageEvent } from "./transport";

/**
 * The OpenAI chat-completions protocol, which more than one provider speaks.
 *
 * OpenRouter is an OpenAI-compatible endpoint, so both it and OpenAI itself are
 * this class with a different base URL and headers. Anthropic and Google are
 * genuinely different protocols and have their own adapters.
 */
export type OpenAiCompatibleOptions = {
  id: string;
  /** Full chat-completions URL, including the path. */
  url: string;
  apiKey: string;
  model: string;
  /** Provider name used in error text, so a failure names who actually failed. */
  displayName: string;
  extraHeaders?: Record<string, string>;
  /**
   * Streaming-capable fetch. **The app must pass `expo/fetch` explicitly**
   * (PRD §10 tech stack) — do not rely on the ambient global. React Native's
   * own `fetch` is `whatwg-fetch` over XHR and its `Response` has no `body`
   * property at all, so SSE cannot be read from it. Defaults to
   * `globalThis.fetch` only as a convenience for Node-side tests.
   */
  fetch?: FetchLike;
};

export class OpenAiCompatibleProvider implements Provider {
  readonly id: string;

  constructor(private opts: OpenAiCompatibleOptions) {
    this.id = opts.id;
  }

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      model: this.opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toOpenAiMessages(req.system, req.messages),
      ...(req.tools.length > 0 ? { tools: req.tools.map(toOpenAiTool) } : {}),
    };

    const opened = await openProviderStream({
      url: this.opts.url,
      displayName: this.opts.displayName,
      fetch: this.opts.fetch,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
          ...this.opts.extraHeaders,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    });

    if ("error" in opened) {
      yield { type: "error", error: opened.error };
      return;
    }

    // Aborting mid-stream rejects the reader, and `readSseEvents` deliberately
    // lets that through so it can be classified here alongside every other
    // transport failure. Without this the exception escaped `runTurn` entirely
    // and the editor showed the transport's own words instead of "Cancelled".
    try {
      yield* this.parseStream(opened.stream);
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
    }
  }

  private async *parseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
    const buffers = new Map<number, ToolCallBuffer>();
    for await (const event of readSseEvents(stream)) {
      yield* parseChunk(event, buffers);
    }
    // Not every provider closes a tool call with `finish_reason: "tool_calls"` —
    // some send "stop", some send no finish_reason at all before ending the
    // stream. Anything still buffered here is a complete tool call that never
    // got its terminator, and silently discarding it makes the agent look like
    // it ignored the user.
    yield* flushToolCalls(buffers);
  }
}

type ToolCallBuffer = { id: string; name: string; args: string };

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

function* flushToolCalls(buffers: Map<number, ToolCallBuffer>): Generator<ProviderStreamEvent> {
  for (const buffer of buffers.values()) {
    // A buffer with no name never received a usable tool call, only fragments.
    if (buffer.name.length === 0) continue;
    yield { type: "toolCall", call: finishToolCall(buffer) };
  }
  buffers.clear();
}

function finishToolCall(buffer: ToolCallBuffer): ToolCall {
  // Malformed or truncated arguments become an empty object rather than dropping
  // the call. The tool layer validates arguments and returns a model-facing
  // error the model can correct on the next iteration; swallowing the call
  // instead makes the agent look like it ignored the user.
  try {
    const parsed: unknown = buffer.args.trim().length > 0 ? JSON.parse(buffer.args) : {};
    const usable = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return { id: buffer.id, name: buffer.name, arguments: usable ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return { id: buffer.id, name: buffer.name, arguments: {} };
  }
}

function* parseChunk(event: string, buffers: Map<number, ToolCallBuffer>): Generator<ProviderStreamEvent> {
  const data = sseData(event);
  if (data === null) return;

  let parsed: {
    choices?: { delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  try {
    parsed = JSON.parse(data);
  } catch {
    // A malformed chunk is not worth failing the turn over — the stream usually
    // recovers on the next one.
    return;
  }

  if (parsed.usage) {
    const event = usageEvent(parsed.usage.prompt_tokens, parsed.usage.completion_tokens);
    if (event) yield event;
  }

  const choice = parsed.choices?.[0];
  if (!choice) return;

  const content = choice.delta?.content;
  if (typeof content === "string" && content.length > 0) yield { type: "text", delta: content };

  const toolCalls = choice.delta?.tool_calls;
  if (Array.isArray(toolCalls)) {
    for (const raw of toolCalls) {
      const entry = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      // Assembled by `index`, not arrival order: parallel tool calls interleave
      // their fragments across chunks.
      const index = typeof entry.index === "number" ? entry.index : 0;
      const buffer = buffers.get(index) ?? { id: "", name: "", args: "" };
      if (typeof entry.id === "string" && entry.id.length > 0) buffer.id = entry.id;
      if (typeof entry.function?.name === "string") buffer.name += entry.function.name;
      if (typeof entry.function?.arguments === "string") buffer.args += entry.function.arguments;
      buffers.set(index, buffer);
    }
  }

  // Flush on *any* non-empty finish_reason. Providers behind OpenRouter disagree
  // about which one closes a tool call, and waiting for "tool_calls"
  // specifically dropped calls from the ones that send "stop".
  if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
    yield* flushToolCalls(buffers);
  }
}
