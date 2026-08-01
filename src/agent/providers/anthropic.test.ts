import { AnthropicProvider } from "./anthropic";
import { CanonicalMessage, Provider, ProviderStreamEvent, ToolCall } from "../types";

/**
 * Wire-format coverage for the Anthropic adapter, written from the documented
 * Messages API shape. **Not verified against the live API** — only OpenRouter has
 * a live smoke test. These pin the translation and the SSE grammar, which is
 * where the OpenRouter adapter's real bugs turned out to live.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function providerFor(chunks: string[]): { provider: Provider; sentBody: () => Record<string, unknown>; headers: () => Record<string, string> } {
  let captured: Record<string, unknown> = {};
  let seenHeaders: Record<string, string> = {};
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    model: "claude-sonnet-4-5",
    fetch: async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(streamOf(chunks), { status: 200 });
    },
  });
  return { provider, sentBody: () => captured, headers: () => seenHeaders };
}

async function collect(provider: Provider, messages: CanonicalMessage[] = []): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of provider.send({
    system: "sys",
    messages,
    tools: [{ name: "rewrite_note", description: "d", parameters: { type: "object" } }],
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

function toolCalls(events: ProviderStreamEvent[]): ToolCall[] {
  return events.filter((e): e is { type: "toolCall"; call: ToolCall } => e.type === "toolCall").map((e) => e.call);
}

function textOf(events: ProviderStreamEvent[]): string {
  return events
    .filter((e): e is { type: "text"; delta: string } => e.type === "text")
    .map((e) => e.delta)
    .join("");
}

function sse(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

describe("AnthropicProvider request shaping", () => {
  it("sends the system prompt as a top-level field, not a message", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider, [{ role: "user", content: "hi" }]);
    expect(sentBody().system).toBe("sys");
    // A system *message* would be rejected: role must be user or assistant.
    expect(JSON.stringify(sentBody().messages)).not.toContain("system");
  });

  it("uses x-api-key and a version header, not Authorization", async () => {
    const { provider, headers } = providerFor([sse("message_stop")]);
    await collect(provider);
    expect(headers()["x-api-key"]).toBe("test-key");
    expect(headers()["anthropic-version"]).toBeTruthy();
    expect(headers().Authorization).toBeUndefined();
  });

  it("declares tools with input_schema rather than parameters", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider);
    expect(sentBody().tools).toEqual([
      { name: "rewrite_note", description: "d", input_schema: { type: "object" } },
    ]);
  });

  it("sends max_tokens, which the API requires", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider);
    expect(typeof sentBody().max_tokens).toBe("number");
  });

  it("carries a tool result as a tool_result block inside a user message", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider, [
      { role: "user", content: "edit" },
      { role: "assistant", toolCalls: [{ id: "call_1", name: "rewrite_note", arguments: { content: "x" } }] },
      { role: "tool", toolCallId: "call_1", content: '{"ok":true}' },
    ]);

    const messages = sentBody().messages as { role: string; content: { type: string; tool_use_id?: string }[] }[];
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "call_1", name: "rewrite_note", input: { content: "x" } }],
    });
    // There is no `tool` role in this API.
    expect(messages[2].role).toBe("user");
    expect(messages[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "call_1", content: '{"ok":true}' });
  });

  it("merges consecutive tool results into one user message", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider, [
      { role: "assistant", toolCalls: [{ id: "a", name: "rewrite_note", arguments: {} }] },
      { role: "tool", toolCallId: "a", content: "1" },
      { role: "tool", toolCallId: "b", content: "2" },
    ]);

    const messages = sentBody().messages as { role: string; content: unknown[] }[];
    // Two user messages in a row are rejected by the API.
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toHaveLength(2);
  });

  /**
   * The API rejects two messages with the same role in a row, and history is not
   * guaranteed to alternate. A turn that hit the iteration cap ends on a tool
   * result — which becomes a *user* message here — and the next turn appends the
   * user's new prompt straight after it. Merging by role is what keeps any
   * history shape sendable, rather than only the shapes a clean turn produces.
   */
  it("merges a user prompt that follows a tool result", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider, [
      { role: "assistant", toolCalls: [{ id: "a", name: "rewrite_note", arguments: {} }] },
      { role: "tool", toolCallId: "a", content: "1" },
      { role: "user", content: "and now this" },
    ]);

    const messages = sentBody().messages as { role: string; content: unknown[] }[];
    expect(messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(messages[1].content).toEqual([
      { type: "tool_result", tool_use_id: "a", content: "1" },
      { type: "text", text: "and now this" },
    ]);
  });

  it("merges consecutive assistant messages", async () => {
    const { provider, sentBody } = providerFor([sse("message_stop")]);
    await collect(provider, [
      { role: "user", content: "go" },
      { role: "assistant", content: "thinking" },
      { role: "assistant", toolCalls: [{ id: "a", name: "read_note", arguments: {} }] },
    ]);

    const messages = sentBody().messages as { role: string; content: unknown[] }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].content).toEqual([
      { type: "text", text: "thinking" },
      { type: "tool_use", id: "a", name: "read_note", input: {} },
    ]);
  });
});

describe("AnthropicProvider streaming", () => {
  it("concatenates text_delta events", async () => {
    const { provider } = providerFor([
      sse("content_block_start", { index: 0, content_block: { type: "text" } }),
      sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello " } }),
      sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "world" } }),
      sse("content_block_stop", { index: 0 }),
      sse("message_stop"),
    ]);
    expect(textOf(await collect(provider))).toBe("Hello world");
  });

  it("assembles a tool call from partial_json fragments", async () => {
    const { provider } = providerFor([
      sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu_1", name: "rewrite_note" } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"cont' } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: 'ent":"hi"}' } }),
      sse("content_block_stop", { index: 0 }),
      sse("message_stop"),
    ]);
    expect(toolCalls(await collect(provider))).toEqual([
      { id: "tu_1", name: "rewrite_note", arguments: { content: "hi" } },
    ]);
  });

  it("keeps two tool blocks apart by index", async () => {
    const { provider } = providerFor([
      sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "a", name: "read_note" } }),
      sse("content_block_start", { index: 1, content_block: { type: "tool_use", id: "b", name: "rewrite_note" } }),
      // Interleaved on purpose: fragments for both blocks arrive mixed together.
      sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"content"' } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
      sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: ':"x"}' } }),
      sse("content_block_stop", { index: 0 }),
      sse("content_block_stop", { index: 1 }),
    ]);
    expect(toolCalls(await collect(provider))).toEqual([
      { id: "a", name: "read_note", arguments: {} },
      { id: "b", name: "rewrite_note", arguments: { content: "x" } },
    ]);
  });

  it("emits a tool call whose block never closed", async () => {
    // Same failure mode as the OpenAI adapter: a stream that ends without its
    // terminator still holds a complete call, and dropping it makes the agent
    // look like it ignored the user.
    const { provider } = providerFor([
      sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu", name: "rewrite_note" } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"content":"x"}' } }),
    ]);
    expect(toolCalls(await collect(provider))).toEqual([
      { id: "tu", name: "rewrite_note", arguments: { content: "x" } },
    ]);
  });

  it("surfaces truncated tool input as empty arguments for the tools to reject", async () => {
    const { provider } = providerFor([
      sse("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu", name: "rewrite_note" } }),
      sse("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"content":"unterm' } }),
      sse("content_block_stop", { index: 0 }),
    ]);
    expect(toolCalls(await collect(provider))).toEqual([{ id: "tu", name: "rewrite_note", arguments: {} }]);
  });

  it("reports usage from message_start and message_delta", async () => {
    const { provider } = providerFor([
      sse("message_start", { message: { usage: { input_tokens: 12, output_tokens: 0 } } }),
      sse("message_delta", { usage: { input_tokens: 0, output_tokens: 7 } }),
    ]);
    const usage = (await collect(provider)).filter((e) => e.type === "usage");
    expect(usage).toEqual([
      { type: "usage", inputTokens: 12, outputTokens: 0 },
      { type: "usage", inputTokens: 0, outputTokens: 7 },
    ]);
  });

  it("surfaces an error event from the stream", async () => {
    const { provider } = providerFor([sse("error", { error: { message: "overloaded" } })]);
    expect(await collect(provider)).toEqual([{ type: "error", error: { kind: "unknown", message: "overloaded" } }]);
  });

  it("ignores a malformed chunk rather than failing the turn", async () => {
    const { provider } = providerFor([
      "event: content_block_delta\ndata: {not json\n\n",
      sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "fine" } }),
    ]);
    expect(textOf(await collect(provider))).toBe("fine");
  });

  it("handles an event split across chunk boundaries", async () => {
    const full = sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "split" } });
    const cut = Math.floor(full.length / 2);
    const { provider } = providerFor([full.slice(0, cut), full.slice(cut)]);
    expect(textOf(await collect(provider))).toBe("split");
  });
});

describe("AnthropicProvider error mapping", () => {
  function failing(status: number, body: string): Provider {
    return new AnthropicProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }),
    });
  }

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [404, "not_found"],
    [500, "unknown"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const events = await collect(failing(status, JSON.stringify({ error: { message: "nope" } })));
    expect(events).toEqual([{ type: "error", error: { kind, message: "nope", status } }]);
  });

  it("reports a cancellation from the signal, whatever the transport threw", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new AnthropicProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => {
        throw new Error("The operation couldn't be completed. (Expo.FetchRequestCanceledException error 1.)");
      },
    });
    const events: ProviderStreamEvent[] = [];
    for await (const event of provider.send({ system: "s", messages: [], tools: [], signal: controller.signal })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: "error", error: { kind: "cancelled", message: "The request was cancelled." } }]);
  });
});
