import { OpenAiProvider } from "./openai";
import { CanonicalMessage, Provider, ProviderStreamEvent, ToolCall } from "../types";

/**
 * Wire-format coverage for the OpenAI Responses adapter.
 *
 * The event payloads here are copied from a real `/v1/responses` stream, not
 * from the docs — including the reasoning item, which is the part that has to
 * survive a round trip. Its failure mode is quiet: replaying a tool call without
 * the reasoning item that preceded it is accepted, and the model then returns an
 * empty final message. So the round-trip assertions below are load-bearing in a
 * way a passing turn would not reveal.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** One SSE event in the shape the API sends: a named `event:` plus a JSON `data:`. */
function sse(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function providerFor(chunks: string[]) {
  let sent: { url: string; body: string; headers: Record<string, string> } | null = null;
  const provider = new OpenAiProvider({
    apiKey: "k",
    model: "gpt-5.6-luna",
    fetch: async (url, init) => {
      sent = { url, body: String(init?.body ?? ""), headers: init?.headers ?? {} };
      return { ok: true, status: 200, body: streamOf(chunks), json: async () => ({}) };
    },
  });
  return {
    provider,
    sentBody: () => JSON.parse(sent!.body) as Record<string, unknown>,
    sentUrl: () => sent!.url,
    sentHeaders: () => sent!.headers,
  };
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

const textOf = (events: ProviderStreamEvent[]) =>
  events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");

const toolCalls = (events: ProviderStreamEvent[]) =>
  events.filter((e) => e.type === "toolCall").map((e) => (e as { call: ToolCall }).call);

/** A reasoning item as the API emits it, trimmed of the 2KB of ciphertext. */
const REASONING = { id: "rs_1", type: "reasoning", content: [], encrypted_content: "gAAAAA-opaque" };

const FUNCTION_CALL = {
  id: "fc_1",
  type: "function_call",
  status: "completed",
  call_id: "call_abc",
  name: "rewrite_note",
  arguments: '{"content":"hi"}',
};

describe("OpenAiProvider request shaping", () => {
  it("posts to /v1/responses, not chat/completions", async () => {
    const { provider, sentUrl } = providerFor([sse("response.completed")]);
    await collect(provider);
    expect(sentUrl()).toBe("https://api.openai.com/v1/responses");
  });

  it("sends the system prompt as instructions, and disables server-side storage", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    await collect(provider);
    const body = sentBody();
    expect(body.instructions).toBe("sys");
    // The app has no backend by design; the conversation must not be retained.
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("declares tools flat, without chat-completions' function nesting", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    await collect(provider);
    expect(sentBody().tools).toEqual([
      { type: "function", name: "rewrite_note", description: "d", parameters: { type: "object" } },
    ]);
  });

  it("carries a tool call and its result as separate top-level items", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    await collect(provider, [
      { role: "user", content: "edit" },
      { role: "assistant", toolCalls: [{ id: "call_abc", name: "rewrite_note", arguments: { content: "x" } }] },
      { role: "tool", toolCallId: "call_abc", content: '{"ok":true}' },
    ]);

    expect(sentBody().input).toEqual([
      { role: "user", content: "edit" },
      { type: "function_call", call_id: "call_abc", name: "rewrite_note", arguments: '{"content":"x"}' },
      { type: "function_call_output", call_id: "call_abc", output: '{"ok":true}' },
    ]);
  });

  it("replays the reasoning item ahead of the call it belongs to", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          { id: "call_abc", name: "rewrite_note", arguments: {}, providerData: { reasoning: [REASONING] } },
        ],
      },
      { role: "tool", toolCallId: "call_abc", content: "{}" },
    ]);

    const input = sentBody().input as Record<string, unknown>[];
    expect(input[0]).toEqual(REASONING);
    expect(input[1]).toMatchObject({ type: "function_call", call_id: "call_abc" });
  });

  it("sends one shared reasoning item once, not once per call", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    // Two parallel calls from one response carry the same reasoning item;
    // replaying it twice is a duplicate item id.
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          { id: "call_a", name: "rewrite_note", arguments: {}, providerData: { reasoning: [REASONING] } },
          { id: "call_b", name: "rewrite_note", arguments: {}, providerData: { reasoning: [REASONING] } },
        ],
      },
    ]);

    const input = sentBody().input as Record<string, unknown>[];
    expect(input.filter((i) => i.type === "reasoning")).toHaveLength(1);
    expect(input.filter((i) => i.type === "function_call")).toHaveLength(2);
  });

  it("ignores providerData that isn't this adapter's", async () => {
    const { provider, sentBody } = providerFor([sse("response.completed")]);
    // History can be rehydrated from storage, or left by a turn against Gemini.
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          { id: "c1", name: "rewrite_note", arguments: {}, providerData: { thoughtSignature: "gemini's" } },
          { id: "c2", name: "rewrite_note", arguments: {}, providerData: "nonsense" },
          { id: "c3", name: "rewrite_note", arguments: {}, providerData: { reasoning: "not an array" } },
        ],
      },
    ]);

    const input = sentBody().input as Record<string, unknown>[];
    expect(input.every((i) => i.type === "function_call")).toBe(true);
  });
});

describe("OpenAiProvider streaming", () => {
  it("concatenates output_text deltas", async () => {
    const { provider } = providerFor([
      sse("response.output_text.delta", { delta: "Hello" }),
      sse("response.output_text.delta", { delta: " world" }),
      sse("response.completed"),
    ]);
    expect(textOf(await collect(provider))).toBe("Hello world");
  });

  it("emits a tool call from output_item.done, keyed by call_id", async () => {
    const { provider } = providerFor([
      sse("response.output_item.added", { output_index: 0, item: { ...FUNCTION_CALL, arguments: "" } }),
      sse("response.output_item.done", { output_index: 0, item: FUNCTION_CALL }),
      sse("response.completed"),
    ]);
    const calls = toolCalls(await collect(provider));
    expect(calls).toHaveLength(1);
    // The item id (fc_1) is not accepted as a function_call_output's call_id.
    expect(calls[0].id).toBe("call_abc");
    expect(calls[0].arguments).toEqual({ content: "hi" });
  });

  it("attaches the reasoning item that preceded the call", async () => {
    const { provider } = providerFor([
      sse("response.output_item.done", { output_index: 0, item: REASONING }),
      sse("response.output_item.added", { output_index: 1, item: { ...FUNCTION_CALL, arguments: "" } }),
      sse("response.output_item.done", { output_index: 1, item: FUNCTION_CALL }),
      sse("response.completed"),
    ]);
    const calls = toolCalls(await collect(provider));
    expect(calls[0].providerData).toEqual({ reasoning: [REASONING] });
  });

  it("omits providerData when the model did no reasoning", async () => {
    const { provider } = providerFor([
      sse("response.output_item.done", { output_index: 0, item: FUNCTION_CALL }),
      sse("response.completed"),
    ]);
    // gpt-4o-mini and friends emit no reasoning item at all.
    expect(toolCalls(await collect(provider))[0].providerData).toBeUndefined();
  });

  it("emits a call whose stream ended before output_item.done", async () => {
    const { provider } = providerFor([
      sse("response.output_item.added", { output_index: 0, item: { ...FUNCTION_CALL, arguments: "" } }),
      sse("response.function_call_arguments.delta", { output_index: 0, delta: '{"content":' }),
      sse("response.function_call_arguments.delta", { output_index: 0, delta: '"hi"}' }),
    ]);
    const calls = toolCalls(await collect(provider));
    expect(calls).toHaveLength(1);
    expect(calls[0].arguments).toEqual({ content: "hi" });
  });

  it("surfaces truncated arguments as empty, for the tools to reject", async () => {
    const { provider } = providerFor([
      sse("response.output_item.done", { output_index: 0, item: { ...FUNCTION_CALL, arguments: '{"content":' } }),
    ]);
    expect(toolCalls(await collect(provider))[0].arguments).toEqual({});
  });

  it("reports usage from response.completed", async () => {
    const { provider } = providerFor([
      sse("response.completed", { response: { usage: { input_tokens: 71, output_tokens: 40 } } }),
    ]);
    const usage = (await collect(provider)).find((e) => e.type === "usage");
    expect(usage).toEqual({ type: "usage", inputTokens: 71, outputTokens: 40 });
  });

  it("surfaces a failed response as an error event", async () => {
    const { provider } = providerFor([
      sse("response.failed", { response: { error: { message: "something broke" } } }),
    ]);
    const events = await collect(provider);
    expect(events.find((e) => e.type === "error")).toEqual({
      type: "error",
      error: { kind: "unknown", message: "something broke" },
    });
  });

  it("ignores a malformed chunk rather than failing the turn", async () => {
    const { provider } = providerFor([
      "event: x\ndata: {not json\n\n",
      sse("response.output_text.delta", { delta: "ok" }),
    ]);
    expect(textOf(await collect(provider))).toBe("ok");
  });

  it("handles an event split across chunk boundaries", async () => {
    const whole = sse("response.output_text.delta", { delta: "split" });
    const at = Math.floor(whole.length / 2);
    const { provider } = providerFor([whole.slice(0, at), whole.slice(at)]);
    expect(textOf(await collect(provider))).toBe("split");
  });
});

describe("OpenAiProvider errors", () => {
  it("maps an unknown model to not_found, despite the 400", async () => {
    const provider = new OpenAiProvider({
      apiKey: "k",
      model: "nope",
      fetch: async () => ({
        ok: false,
        status: 400,
        body: null,
        json: async () => ({ error: { message: "The requested model 'nope' does not exist." } }),
      }),
    });
    const events = await collect(provider);
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "not_found" } });
  });

  it("reports a cancellation from the signal, whatever the transport threw", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenAiProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => {
        throw new Error("Expo.FetchRequestCanceledException");
      },
    });

    const events: ProviderStreamEvent[] = [];
    for await (const event of provider.send({ system: "s", messages: [], tools: [], signal: controller.signal })) {
      events.push(event);
    }
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "cancelled" } });
  });
});
