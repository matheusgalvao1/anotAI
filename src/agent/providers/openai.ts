import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";
import { FetchLike, openProviderStream, readSseEvents, sseData, toTransportError, usageEvent } from "./transport";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type OpenAiProviderOptions = {
  apiKey: string;
  model: string;
  /** See OpenRouterProviderOptions — must be `expo/fetch` in the app. */
  fetch?: FetchLike;
};

/**
 * OpenAI's Responses API — **not** chat-completions, which the OpenRouter
 * adapter speaks.
 *
 * This used to be `OpenAiCompatibleProvider` pointed at `/v1/chat/completions`,
 * and that endpoint cannot run this app for every OpenAI model: some reject
 * function tools outright with "Function tools with reasoning_effort are not
 * supported for <model> in /v1/chat/completions". Which models is not
 * predictable from the id — `o3`, `o4-mini`, `gpt-5` and `gpt-5-mini` all accept
 * tools there, `gpt-5.6-luna` does not — so there was no filter that could be
 * right. Every one of them accepts tools on `/v1/responses`, so this adapter
 * speaks only that and the question disappears rather than being managed.
 *
 * How it differs from chat-completions:
 *
 * - The system prompt is `instructions`, a top-level field.
 * - Messages are `input` **items**, and a tool call and its result are items in
 *   their own right (`function_call` / `function_call_output`) rather than a
 *   field on an assistant message and a `tool` role.
 * - Tool schemas are flat — `{type, name, description, parameters}` — not nested
 *   under a `function` key.
 * - Streaming is named event types on the payload (`response.output_text.delta`
 *   and friends), and a `function_call` arrives complete on
 *   `response.output_item.done`, so its arguments need no reassembly.
 *
 * `store: false` is deliberate. The Responses API otherwise retains the
 * conversation server-side to be resumed by `previous_response_id`, and this app
 * has no backend and no telemetry by design (PRD §1) — leaving note content on
 * OpenAI's servers to save resending it is not a trade this project makes. The
 * cost of opting out is that reasoning state has to travel in the request, which
 * is what `include` and `ResponsesCallState` below are for.
 */
export class OpenAiProvider implements Provider {
  readonly id = "openai";

  constructor(private opts: OpenAiProviderOptions) {}

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      model: this.opts.model,
      stream: true,
      store: false,
      instructions: req.system,
      input: toResponsesInput(req.messages),
      ...(req.tools.length > 0 ? { tools: req.tools.map(toResponsesTool) } : {}),
      // Without this the reasoning items come back with an empty
      // `encrypted_content` and cannot be replayed. Harmless for models that do
      // no reasoning — they simply emit no reasoning items.
      include: ["reasoning.encrypted_content"],
    };

    const opened = await openProviderStream({
      url: OPENAI_RESPONSES_URL,
      displayName: "OpenAI",
      fetch: this.opts.fetch,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      },
    });

    if ("error" in opened) {
      yield { type: "error", error: opened.error };
      return;
    }

    try {
      yield* parseResponsesStream(opened.stream);
    } catch (err) {
      yield { type: "error", error: toTransportError(err, req.signal) };
    }
  }
}

/** A function call being assembled, keyed by its position in the response's output. */
type PendingCall = { callId: string; name: string; args: string };

async function* parseResponsesStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ProviderStreamEvent> {
  const pending = new Map<number, PendingCall>();
  // Reasoning items seen so far in this response. They arrive before the calls
  // they belong to, and every call in the response is replayed behind them.
  const reasoning: unknown[] = [];

  for await (const event of readSseEvents(stream)) {
    const data = sseData(event);
    if (data === null) continue;

    let parsed: ResponsesEvent;
    try {
      parsed = JSON.parse(data) as ResponsesEvent;
    } catch {
      continue; // a malformed chunk isn't worth failing the turn over
    }

    switch (parsed.type) {
      case "response.output_text.delta": {
        if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
          yield { type: "text", delta: parsed.delta };
        }
        break;
      }

      case "response.output_item.added": {
        const item = parsed.item;
        if (item?.type === "function_call" && typeof item.name === "string") {
          pending.set(parsed.output_index ?? 0, {
            callId: typeof item.call_id === "string" ? item.call_id : "",
            name: item.name,
            args: typeof item.arguments === "string" ? item.arguments : "",
          });
        }
        break;
      }

      // Only a fallback. A completed `function_call` carries its whole
      // `arguments` string on output_item.done, so these deltas are normally
      // redundant — they matter when a stream is cut off before that lands.
      case "response.function_call_arguments.delta": {
        const call = pending.get(parsed.output_index ?? 0);
        if (call && typeof parsed.delta === "string") call.args += parsed.delta;
        break;
      }

      case "response.output_item.done": {
        const index = parsed.output_index ?? 0;
        const item = parsed.item;

        if (item?.type === "reasoning") {
          // Kept verbatim rather than rebuilt: it is opaque, and the API is the
          // only thing that knows what it must contain to be accepted back.
          reasoning.push(item);
          break;
        }

        if (item?.type === "function_call" && typeof item.name === "string") {
          pending.delete(index);
          yield {
            type: "toolCall",
            call: finishCall(
              {
                callId: typeof item.call_id === "string" ? item.call_id : "",
                name: item.name,
                args: typeof item.arguments === "string" ? item.arguments : "",
              },
              reasoning,
            ),
          };
        }
        break;
      }

      case "response.completed": {
        const usage = parsed.response?.usage;
        const usageReport = usage ? usageEvent(usage.input_tokens, usage.output_tokens) : null;
        if (usageReport) yield usageReport;
        break;
      }

      case "error":
      case "response.failed": {
        const message = parsed.message ?? parsed.response?.error?.message;
        yield {
          type: "error",
          error: { kind: "unknown", message: typeof message === "string" ? message : "OpenAI reported an error." },
        };
        break;
      }
    }
  }

  // A stream that ended before `output_item.done` still holds real calls.
  // Dropping them makes the agent look like it ignored the user — the same
  // trailing flush the other three adapters do.
  for (const call of pending.values()) {
    if (call.name.length > 0) yield { type: "toolCall", call: finishCall(call, reasoning) };
  }
}

function finishCall(call: PendingCall, reasoning: unknown[]): ToolCall {
  // Malformed or truncated arguments become an empty object rather than a
  // dropped call, so the tool layer can return an error the model can correct.
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = call.args.trim().length > 0 ? JSON.parse(call.args) : {};
    if (isPlainObject(parsed)) args = parsed;
  } catch {
    args = {};
  }

  return {
    // `call_id` is what a `function_call_output` is matched on, so it is the
    // id the loop should carry. The item id (`fc_…`) is a different value and
    // is not accepted there.
    id: call.callId,
    name: call.name,
    arguments: args,
    ...(reasoning.length > 0 ? { providerData: { reasoning: [...reasoning] } satisfies ResponsesCallState } : {}),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The reasoning items that have to be replayed alongside a tool call this model
 * issued, carried on `ToolCall.providerData`.
 *
 * Its own type and its own guard, deliberately not shared with Gemini's
 * `GoogleCallState` (see AGENTS.md) even though the two exist for the same
 * reason. The failure mode here is quieter than Gemini's and worse for it:
 * dropping the reasoning item does **not** error, the model simply returns an
 * empty final message, so the turn "succeeds" having said nothing.
 */
type ResponsesCallState = { reasoning: unknown[] };

/** Read back defensively — `providerData` is `unknown`, and may be another adapter's. */
function responsesCallState(data: unknown): ResponsesCallState {
  if (!isPlainObject(data)) return { reasoning: [] };
  const items = data.reasoning;
  return { reasoning: Array.isArray(items) ? items.filter(isPlainObject) : [] };
}

/**
 * Canonical messages → Responses `input` items.
 *
 * A tool call and its result are top-level items here, not a field on an
 * assistant message and a `tool` role, so the assistant turn expands into
 * several items: its reasoning first, then one `function_call` each.
 */
function toResponsesInput(messages: CanonicalMessage[]): unknown[] {
  const out: unknown[] = [];
  // One reasoning item covers every call in the response that produced it, so
  // the same item arrives on each of those calls. Sending it twice is a
  // duplicate item id.
  const emittedReasoning = new Set<string>();

  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
      continue;
    }

    if (m.role === "assistant" && "toolCalls" in m) {
      for (const tc of m.toolCalls) {
        for (const item of responsesCallState(tc.providerData).reasoning) {
          const id = isPlainObject(item) && typeof item.id === "string" ? item.id : null;
          if (id !== null) {
            if (emittedReasoning.has(id)) continue;
            emittedReasoning.add(id);
          }
          out.push(item);
        }
      }
      for (const tc of m.toolCalls) {
        out.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
      }
      continue;
    }

    out.push({ role: m.role, content: (m as { content: string }).content });
  }

  return out;
}

/** Flat, unlike chat-completions' `{type:"function", function:{…}}` nesting. */
function toResponsesTool(tool: ToolSchema): unknown {
  return { type: "function", name: tool.name, description: tool.description, parameters: tool.parameters };
}

type ResponsesItem = {
  type?: string;
  id?: unknown;
  call_id?: unknown;
  name?: unknown;
  arguments?: unknown;
};

type ResponsesEvent = {
  type?: string;
  output_index?: number;
  delta?: unknown;
  item?: ResponsesItem;
  message?: unknown;
  response?: {
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
    error?: { message?: unknown };
  };
};
