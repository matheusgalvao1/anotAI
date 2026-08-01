import { GoogleProvider } from "./google";
import { CanonicalMessage, Provider, ProviderStreamEvent, ToolCall } from "../types";

/**
 * Wire-format coverage for the Gemini adapter. These pin the translation, which
 * for Gemini is the riskiest part: it calls its assistant role `model`, keys tool
 * results by name, and signs its own tool calls.
 *
 * The thought-signature cases came from a live failure, not the docs: the adapter
 * was written against the documented shape, passed every test here, and still
 * broke on the second request of a real turn. Anything asserting a *round trip*
 * below is load-bearing for that reason.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function providerFor(chunks: string[]): {
  provider: Provider;
  sentBody: () => Record<string, unknown>;
  url: () => string;
  headers: () => Record<string, string>;
} {
  let captured: Record<string, unknown> = {};
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const provider = new GoogleProvider({
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    fetch: async (url, init) => {
      seenUrl = url;
      captured = JSON.parse(String(init?.body));
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(streamOf(chunks), { status: 200 });
    },
  });
  return { provider, sentBody: () => captured, url: () => seenUrl, headers: () => seenHeaders };
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

function chunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textChunk(text: string): string {
  return chunk({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe("GoogleProvider request shaping", () => {
  it("puts the model in the URL and asks for SSE", async () => {
    const { provider, url } = providerFor([textChunk("hi")]);
    await collect(provider);
    expect(url()).toContain("/models/gemini-2.5-flash:streamGenerateContent");
    // Without alt=sse Gemini returns a JSON array that only completes at the
    // end, which defeats streaming entirely.
    expect(url()).toContain("alt=sse");
  });

  it("sends the key as a header, never in the URL", async () => {
    const { provider, url, headers } = providerFor([textChunk("hi")]);
    await collect(provider);
    expect(headers()["x-goog-api-key"]).toBe("test-key");
    // A key in the query string can end up in logs and crash reports.
    expect(url()).not.toContain("test-key");
    expect(url()).not.toContain("key=");
  });

  it("sends the system prompt as systemInstruction", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider);
    expect(sentBody().systemInstruction).toEqual({ parts: [{ text: "sys" }] });
  });

  it("declares tools under functionDeclarations", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider);
    expect(sentBody().tools).toEqual([
      { functionDeclarations: [{ name: "rewrite_note", description: "d", parameters: { type: "object" } }] },
    ]);
  });

  it("renames the assistant role to model", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
    const contents = sentBody().contents as { role: string }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model"]);
  });

  it("keys a tool result by function name rather than by id", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [
      { role: "assistant", toolCalls: [{ id: "call_1", name: "rewrite_note", arguments: { content: "x" } }] },
      { role: "tool", toolCallId: "call_1", content: '{"ok":true}' },
    ]);

    const contents = sentBody().contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents[0]).toEqual({
      role: "model",
      parts: [{ functionCall: { name: "rewrite_note", args: { content: "x" } } }],
    });
    // The name is recovered from the matching call — the id would be meaningless
    // to Gemini, which correlates results by name.
    expect(contents[1].parts[0]).toEqual({
      functionResponse: { name: "rewrite_note", response: { result: '{"ok":true}' } },
    });
  });

  it("falls back to the call id when no matching call is in history", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [{ role: "tool", toolCallId: "orphan", content: "{}" }]);
    const contents = sentBody().contents as { parts: { functionResponse?: { name?: string } }[] }[];
    expect(contents[0].parts[0].functionResponse?.name).toBe("orphan");
  });

  it("returns the thoughtSignature with the call it belongs to", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          {
            id: "abc123",
            name: "rewrite_note",
            arguments: { content: "x" },
            providerData: { id: "abc123", thoughtSignature: "SIG" },
          },
        ],
      },
      { role: "tool", toolCallId: "abc123", content: "{}" },
    ]);

    const contents = sentBody().contents as { role: string; parts: Record<string, unknown>[] }[];
    // The signature sits beside functionCall, not inside it. Nesting it is
    // silently accepted by JSON.stringify and rejected by Gemini.
    expect(contents[0].parts[0]).toEqual({
      functionCall: { name: "rewrite_note", args: { content: "x" }, id: "abc123" },
      thoughtSignature: "SIG",
    });
    expect(contents[1].parts[0]).toEqual({
      functionResponse: { name: "rewrite_note", id: "abc123", response: { result: "{}" } },
    });
  });

  it("never echoes an id Gemini didn't issue", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    // A pre-Gemini-3 model sends no id, so the adapter synthesised "read_note-0".
    // Sending that back as though it were the model's own id is worse than
    // omitting it, since Gemini would try to correlate against an id it never saw.
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          { id: "read_note-0", name: "read_note", arguments: {}, providerData: { thoughtSignature: "SIG" } },
        ],
      },
      { role: "tool", toolCallId: "read_note-0", content: "{}" },
    ]);

    const contents = sentBody().contents as { parts: Record<string, unknown>[] }[];
    expect(contents[0].parts[0]).toEqual({ functionCall: { name: "read_note", args: {} }, thoughtSignature: "SIG" });
    expect(contents[1].parts[0]).toEqual({ functionResponse: { name: "read_note", response: { result: "{}" } } });
  });

  it("ignores providerData that isn't Gemini's", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    // History can be rehydrated from storage, or carried over from a turn against
    // a different provider — so the shape is validated, not trusted.
    await collect(provider, [
      {
        role: "assistant",
        toolCalls: [
          { id: "c1", name: "read_note", arguments: {}, providerData: { id: 42, thoughtSignature: ["nope"] } },
          { id: "c2", name: "read_note", arguments: {}, providerData: "openai-leftovers" },
        ],
      },
    ]);

    const contents = sentBody().contents as { parts: Record<string, unknown>[] }[];
    expect(contents[0].parts).toEqual([
      { functionCall: { name: "read_note", args: {} } },
      { functionCall: { name: "read_note", args: {} } },
    ]);
  });

  it("merges a user prompt that follows a tool result", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [
      { role: "assistant", toolCalls: [{ id: "a", name: "read_note", arguments: {} }] },
      { role: "tool", toolCallId: "a", content: "1" },
      { role: "user", content: "and now this" },
    ]);

    const contents = sentBody().contents as { role: string; parts: unknown[] }[];
    expect(contents.map((c) => c.role)).toEqual(["model", "user"]);
    expect(contents[1].parts).toHaveLength(2);
  });

  it("merges consecutive tool results into one content", async () => {
    const { provider, sentBody } = providerFor([textChunk("hi")]);
    await collect(provider, [
      { role: "assistant", toolCalls: [{ id: "a", name: "read_note", arguments: {} }] },
      { role: "tool", toolCallId: "a", content: "1" },
      { role: "tool", toolCallId: "b", content: "2" },
    ]);
    const contents = sentBody().contents as { role: string; parts: unknown[] }[];
    const userContents = contents.filter((c) => c.role === "user");
    expect(userContents).toHaveLength(1);
    expect(userContents[0].parts).toHaveLength(2);
  });
});

describe("GoogleProvider streaming", () => {
  it("concatenates text parts across chunks", async () => {
    const { provider } = providerFor([textChunk("Hello "), textChunk("world")]);
    expect(textOf(await collect(provider))).toBe("Hello world");
  });

  it("emits a function call with a synthesised id when the model sends none", async () => {
    const { provider } = providerFor([
      chunk({
        candidates: [{ content: { parts: [{ functionCall: { name: "rewrite_note", args: { content: "hi" } } }] } }],
      }),
    ]);
    const calls = toolCalls(await collect(provider));
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("rewrite_note");
    expect(calls[0].arguments).toEqual({ content: "hi" });
    // The loop needs an id to correlate the result; older models supply none.
    expect(calls[0].id).toBeTruthy();
  });

  it("captures the model's own call id and thoughtSignature", async () => {
    const { provider } = providerFor([
      chunk({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "rewrite_note", args: { content: "hi" }, id: "YVx1ztAe" }, thoughtSignature: "SIG" },
              ],
            },
          },
        ],
      }),
    ]);
    const calls = toolCalls(await collect(provider));
    // Gemini's id is preferred over a synthesised one so the response can be
    // paired with it, and the signature has to survive into history to be replayed.
    expect(calls[0].id).toBe("YVx1ztAe");
    expect(calls[0].providerData).toEqual({ id: "YVx1ztAe", thoughtSignature: "SIG" });
  });

  /**
   * The synthesised counter used to restart at zero on every request, so a turn
   * that called `read_note` in two iterations put the id `read_note-0` into the
   * history twice. Gemini itself tolerates that — it pairs results by function
   * name — but the loop pairs by id, and switching provider mid-session then
   * replays duplicate tool-call ids to an API that correlates by them.
   */
  it("does not reuse an id already present in the conversation", async () => {
    const { provider } = providerFor([
      chunk({ candidates: [{ content: { parts: [{ functionCall: { name: "read_note", args: {} } }] } }] }),
    ]);
    const calls = toolCalls(
      await collect(provider, [
        { role: "assistant", toolCalls: [{ id: "read_note-0", name: "read_note", arguments: {} }] },
        { role: "tool", toolCallId: "read_note-0", content: "{}" },
      ]),
    );
    expect(calls[0].id).not.toBe("read_note-0");
  });

  it("omits providerData when the model sent neither an id nor a signature", async () => {
    const { provider } = providerFor([
      chunk({ candidates: [{ content: { parts: [{ functionCall: { name: "read_note", args: {} } }] } }] }),
    ]);
    const calls = toolCalls(await collect(provider));
    // An all-undefined state object would otherwise be carried into stored history.
    expect(calls[0].providerData).toBeUndefined();
  });

  it("gives two calls of the same name distinct ids", async () => {
    const { provider } = providerFor([
      chunk({ candidates: [{ content: { parts: [{ functionCall: { name: "read_note", args: {} } }] } }] }),
      chunk({ candidates: [{ content: { parts: [{ functionCall: { name: "read_note", args: {} } }] } }] }),
    ]);
    const calls = toolCalls(await collect(provider));
    expect(calls).toHaveLength(2);
    // Colliding ids would make the loop pair both results with one call.
    expect(calls[0].id).not.toBe(calls[1].id);
  });

  it("treats missing args as empty arguments", async () => {
    const { provider } = providerFor([
      chunk({ candidates: [{ content: { parts: [{ functionCall: { name: "read_note" } }] } }] }),
    ]);
    expect(toolCalls(await collect(provider))[0].arguments).toEqual({});
  });

  it("reports usage from usageMetadata", async () => {
    const { provider } = providerFor([
      chunk({ candidates: [{ content: { parts: [] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 4 } }),
    ]);
    expect((await collect(provider)).filter((e) => e.type === "usage")).toEqual([
      { type: "usage", inputTokens: 30, outputTokens: 4 },
    ]);
  });

  it("ignores a malformed chunk rather than failing the turn", async () => {
    const { provider } = providerFor(["data: {not json\n\n", textChunk("fine")]);
    expect(textOf(await collect(provider))).toBe("fine");
  });

  it("handles an event split across chunk boundaries", async () => {
    const full = textChunk("split");
    const cut = Math.floor(full.length / 2);
    const { provider } = providerFor([full.slice(0, cut), full.slice(cut)]);
    expect(textOf(await collect(provider))).toBe("split");
  });

  it("handles a stream that ends without a trailing blank line", async () => {
    const { provider } = providerFor([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "last" }] } }] })}`]);
    expect(textOf(await collect(provider))).toBe("last");
  });
});

describe("GoogleProvider error mapping", () => {
  function failing(status: number, body: string): Provider {
    return new GoogleProvider({
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
    const provider = new GoogleProvider({
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
