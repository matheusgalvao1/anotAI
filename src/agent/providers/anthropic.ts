import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";
import { FetchLike, openProviderStream, readSseEvents, sseData, toTransportError, usageEvent } from "./transport";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Required by the API, unlike OpenAI's where it's optional. Generous: a rewrite of a large note is the worst case. */
const MAX_TOKENS = 8192;

export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  /** See OpenRouterProviderOptions — must be `expo/fetch` in the app. */
  fetch?: FetchLike;
};

/**
 * Anthropic's Messages API. A genuinely different protocol from OpenAI's, in
 * four ways that all matter here:
 *
 * - The system prompt is a **top-level field**, not a message with role `system`.
 * - Tool calls and their results are **content blocks** (`tool_use` /
 *   `tool_result`) inside user and assistant messages, not a separate `tool` role.
 * - Tool schemas use `input_schema`, not `parameters`.
 * - Streaming is **named events** (`content_block_delta` and friends) rather than
 *   one chunk shape, and tool arguments arrive as `partial_json` fragments that
 *   have to be accumulated per block index.
 *
 * Also note the auth header is `x-api-key`, not `Authorization: Bearer`.
 */
export class AnthropicProvider implements Provider {
  readonly id = "anthropic";

  constructor(private opts: AnthropicProviderOptions) {}

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      model: this.opts.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      ...(req.tools.length > 0 ? { tools: req.tools.map(toAnthropicTool) } : {}),
    };

    const opened = await openProviderStream({
      url: ANTHROPIC_URL,
      displayName: "Anthropic",
      fetch: this.opts.fetch,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.opts.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
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
    // transport failure rather than escaping `runTurn` as a raw exception.
    try {
      yield* parseAnthropicStream(opened.stream);
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
    }
  }
}

/** Tool blocks are keyed by index while their arguments stream in as text fragments. */
type ToolBlock = { id: string; name: string; json: string };

async function* parseAnthropicStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
  const blocks = new Map<number, ToolBlock>();

  for await (const event of readSseEvents(stream)) {
    const data = sseData(event);
    if (data === null) continue;

    let parsed: AnthropicEvent;
    try {
      parsed = JSON.parse(data) as AnthropicEvent;
    } catch {
      continue; // a malformed chunk isn't worth failing the turn over
    }

    switch (parsed.type) {
      case "content_block_start": {
        const block = parsed.content_block;
        if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          blocks.set(parsed.index ?? 0, { id: block.id, name: block.name, json: "" });
        }
        break;
      }

      case "content_block_delta": {
        const delta = parsed.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          yield { type: "text", delta: delta.text };
        }
        if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const block = blocks.get(parsed.index ?? 0);
          if (block) block.json += delta.partial_json;
        }
        break;
      }

      case "content_block_stop": {
        const index = parsed.index ?? 0;
        const block = blocks.get(index);
        if (block) {
          blocks.delete(index);
          yield { type: "toolCall", call: finishToolBlock(block) };
        }
        break;
      }

      case "message_delta":
      case "message_start": {
        // Input tokens arrive on message_start, output on message_delta's usage.
        const usage = parsed.usage ?? parsed.message?.usage;
        const usageReport = usage ? usageEvent(usage.input_tokens, usage.output_tokens) : null;
        if (usageReport) yield usageReport;
        break;
      }

      case "error": {
        const message = parsed.error?.message;
        yield {
          type: "error",
          error: { kind: "unknown", message: typeof message === "string" ? message : "Anthropic reported an error." },
        };
        break;
      }
    }
  }

  // A stream that ends without content_block_stop still holds complete calls.
  // Same failure mode as the OpenAI adapter's trailing flush: dropping them
  // makes the agent look like it ignored the user.
  for (const block of blocks.values()) {
    yield { type: "toolCall", call: finishToolBlock(block) };
  }
}

function finishToolBlock(block: ToolBlock): ToolCall {
  // Malformed input becomes empty arguments rather than a dropped call, so the
  // tool layer can return a model-facing error the model can correct.
  try {
    const parsed: unknown = block.json.trim().length > 0 ? JSON.parse(block.json) : {};
    const usable = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return { id: block.id, name: block.name, arguments: usable ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return { id: block.id, name: block.name, arguments: {} };
  }
}

type AnthropicMessage = { role: "user" | "assistant"; content: unknown[] };

/**
 * Appends a content block, merging into the previous message when the role
 * matches.
 *
 * The API rejects two messages with the same role in a row, and the canonical
 * history does not guarantee alternation: a `tool` result becomes a *user*
 * message here, so a turn that ended on one is immediately followed by the next
 * turn's prompt. Merging by role is what makes every history shape sendable
 * rather than only the ones a clean turn produces.
 */
function appendBlock(out: AnthropicMessage[], role: "user" | "assistant", block: unknown): void {
  const last = out[out.length - 1];
  if (last?.role === role) last.content.push(block);
  else out.push({ role, content: [block] });
}

/**
 * Canonical messages → Anthropic's shape.
 *
 * The awkward part is that a `tool` result is not its own role: it must ride
 * inside a **user** message as a `tool_result` block.
 */
function toAnthropicMessages(messages: CanonicalMessage[]): unknown[] {
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      appendBlock(out, "user", { type: "tool_result", tool_use_id: m.toolCallId, content: m.content });
      continue;
    }

    if (m.role === "assistant" && "toolCalls" in m) {
      for (const tc of m.toolCalls) {
        appendBlock(out, "assistant", { type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      continue;
    }

    appendBlock(out, m.role, { type: "text", text: (m as { content: string }).content });
  }

  return out;
}

function toAnthropicTool(tool: ToolSchema): unknown {
  // `input_schema`, not `parameters`, and not nested under a `function` key.
  return { name: tool.name, description: tool.description, input_schema: tool.parameters };
}

type AnthropicEvent = {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: unknown; name?: unknown };
  delta?: { type?: string; text?: unknown; partial_json?: unknown };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
  message?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  error?: { message?: unknown };
};
