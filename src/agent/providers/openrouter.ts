import { CanonicalMessage, Provider, ProviderError, ProviderRequest, ProviderStreamEvent, ToolCall, ToolSchema } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
  /** Sent as HTTP-Referer / X-Title per OpenRouter's attribution convention. No user identifiers. */
  referer?: string;
  title?: string;
};

/**
 * Translates the canonical agent-loop format to/from OpenRouter's OpenAI-
 * shaped chat completions API. This is the only provider implementation in
 * v1; adding OpenAI/Anthropic/Google (PRD §14.1) means adding sibling files
 * that implement the same Provider interface, not touching the loop.
 *
 * NOTE: streaming behavior needs validation against physical iOS/Android
 * hardware early (PRD §11, §12) — RN's fetch streaming support has
 * historically been fragile.
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

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
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

    if (!response.ok || !response.body) {
      yield { type: "error", error: await toHttpError(response) };
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

async function toHttpError(response: Response): Promise<ProviderError> {
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
  if (err instanceof Error && err.name === "AbortError") {
    return { kind: "timeout", message: "The request was aborted." };
  }
  return { kind: "network", message: err instanceof Error ? err.message : "Network request failed." };
}

type ToolCallBuffer = { id: string; name: string; args: string };

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

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        yield* parseSseEvent(rawEvent, toolCallBuffers);
      }
    }
  } finally {
    reader.releaseLock();
  }
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

    if (choice.finish_reason === "tool_calls") {
      for (const buf of buffers.values()) {
        const call: ToolCall = { id: buf.id, name: buf.name, arguments: safeParseJson(buf.args) };
        yield { type: "toolCall", call };
      }
      buffers.clear();
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
