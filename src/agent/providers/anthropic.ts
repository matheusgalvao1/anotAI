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

    const doFetch = resolveFetch(this.opts.fetch);
    if (!doFetch) {
      yield {
        type: "error",
        error: { kind: "network", message: "No fetch implementation available. Pass one via the provider options." },
      };
      return;
    }

    let response: FetchLikeResponse;
    try {
      response = await doFetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.opts.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
      return;
    }

    if (!response.ok) {
      const message = await readErrorMessage(response, `Anthropic request failed (HTTP ${response.status}).`);
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
      yield* parseAnthropicStream(response.body);
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
        if (usage) {
          const inputTokens = Number(usage.input_tokens ?? 0);
          const outputTokens = Number(usage.output_tokens ?? 0);
          if (Number.isFinite(inputTokens) && Number.isFinite(outputTokens) && inputTokens + outputTokens > 0) {
            yield { type: "usage", inputTokens, outputTokens };
          }
        }
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

/**
 * Canonical messages → Anthropic's shape.
 *
 * The awkward part is that a `tool` result is not its own role: it must ride
 * inside a **user** message as a `tool_result` block. Consecutive tool results
 * are merged into one user message, because the API rejects two user messages in
 * a row.
 */
function toAnthropicMessages(messages: CanonicalMessage[]): unknown[] {
  const out: { role: "user" | "assistant"; content: unknown[] }[] = [];

  for (const m of messages) {
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === "user") last.content.push(block);
      else out.push({ role: "user", content: [block] });
      continue;
    }

    if (m.role === "assistant" && "toolCalls" in m) {
      out.push({
        role: "assistant",
        content: m.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments })),
      });
      continue;
    }

    out.push({ role: m.role, content: [{ type: "text", text: (m as { content: string }).content }] });
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
