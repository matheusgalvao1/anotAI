import { OpenRouterProvider } from "./openrouter";
import { CanonicalMessage, Provider, ProviderStreamEvent, ToolCall } from "../types";

/**
 * Deterministic coverage for the OpenRouter adapter. The live smoke test
 * (`openrouter.live.test.ts`, run only via `npm run test:live`) proves the
 * happy path against the real API; these tests cover the wire-format edge cases
 * that a happy-path request never exercises — fragmented events, CRLF
 * separators, streams that end without a terminator, tool calls closed with an
 * unexpected finish_reason, malformed JSON, and HTTP failure mapping.
 *
 * `fetch` is injected rather than stubbed globally, so these never depend on
 * whichever fetch the ambient runtime happens to provide.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function providerFor(chunks: string[]): { provider: Provider; sentBody: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const provider = new OpenRouterProvider({
    apiKey: "test-key",
    model: "test-model",
    fetch: async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response(streamOf(chunks), { status: 200 });
    },
  });
  return { provider, sentBody: () => captured };
}

function failingProvider(status: number, body: string): Provider {
  return new OpenRouterProvider({
    apiKey: "test-key",
    model: "test-model",
    fetch: async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }),
  });
}

async function collect(provider: Provider, messages: CanonicalMessage[] = []): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of provider.send({
    system: "sys",
    messages,
    tools: [],
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

async function collectWith(provider: Provider, signal: AbortSignal): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of provider.send({ system: "sys", messages: [], tools: [], signal })) {
    events.push(event);
  }
  return events;
}

/**
 * A stream that delivers some chunks and then fails, as an aborted read does.
 *
 * Pull-based on purpose: `controller.error()` discards anything still queued, so
 * enqueueing everything up front and then erroring would deliver no chunks at
 * all and wouldn't test a *mid*-stream failure.
 */
function erroringStream(chunks: string[], err: unknown): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[next++]));
        return;
      }
      controller.error(err);
    },
  });
}

/**
 * What `expo/fetch` actually throws when its request is cancelled. The name is
 * not `AbortError` and matches nothing standard — which is the whole reason
 * cancellation is classified from the signal rather than from the error.
 */
function expoCancellation(): Error {
  return new Error("The operation couldn’t be completed. (Expo.FetchRequestCanceledException error 1.)");
}

function toolCalls(events: ProviderStreamEvent[]): ToolCall[] {
  return events.filter((e): e is { type: "toolCall"; call: ToolCall } => e.type === "toolCall").map((e) => e.call);
}

function textOf(events: ProviderStreamEvent[]): string {
  return events.filter((e): e is { type: "text"; delta: string } => e.type === "text").map((e) => e.delta).join("");
}

function dataEvent(payload: unknown, separator = "\n\n"): string {
  return `data: ${JSON.stringify(payload)}${separator}`;
}

const TOOL_CALL_DELTA = {
  choices: [
    {
      delta: {
        tool_calls: [
          { index: 0, id: "call_1", function: { name: "rewrite_note", arguments: '{"content":"hello"}' } },
        ],
      },
    },
  ],
};

describe("OpenRouterProvider text streaming", () => {
  it("concatenates text deltas across events", async () => {
    const { provider } = providerFor([
      dataEvent({ choices: [{ delta: { content: "Hel" } }] }),
      dataEvent({ choices: [{ delta: { content: "lo." } }] }),
      "data: [DONE]\n\n",
    ]);
    expect(textOf(await collect(provider))).toBe("Hello.");
  });

  it("reassembles an event split across chunk boundaries", async () => {
    const full = dataEvent({ choices: [{ delta: { content: "split across chunks" } }] });
    const midpoint = Math.floor(full.length / 2);
    const { provider } = providerFor([full.slice(0, midpoint), full.slice(midpoint)]);
    expect(textOf(await collect(provider))).toBe("split across chunks");
  });

  it("handles CRLF event separators", async () => {
    const { provider } = providerFor([dataEvent({ choices: [{ delta: { content: "crlf" } }] }, "\r\n\r\n")]);
    expect(textOf(await collect(provider))).toBe("crlf");
  });

  it("emits the final event when the stream ends without a trailing blank line", async () => {
    const { provider } = providerFor([dataEvent({ choices: [{ delta: { content: "no terminator" } }] }).trimEnd()]);
    expect(textOf(await collect(provider))).toBe("no terminator");
  });

  it("skips malformed JSON payloads instead of throwing", async () => {
    const { provider } = providerFor([
      "data: {not valid json\n\n",
      dataEvent({ choices: [{ delta: { content: "survived" } }] }),
    ]);
    expect(textOf(await collect(provider))).toBe("survived");
  });

  it("ignores OpenRouter's keep-alive comment lines", async () => {
    const { provider } = providerFor([
      ": OPENROUTER PROCESSING\n\n",
      dataEvent({ choices: [{ delta: { content: "after keepalive" } }] }),
    ]);
    const events = await collect(provider);
    expect(textOf(events)).toBe("after keepalive");
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("reports usage when the API includes it", async () => {
    const { provider } = providerFor([
      dataEvent({ usage: { prompt_tokens: 120, completion_tokens: 45 } }),
      "data: [DONE]\n\n",
    ]);
    expect(await collect(provider)).toContainEqual({ type: "usage", inputTokens: 120, outputTokens: 45 });
  });
});

describe("OpenRouterProvider tool-call assembly", () => {
  it("assembles a tool call streamed one fragment at a time", async () => {
    const { provider } = providerFor([
      dataEvent({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "patch_note" } }] } }] }),
      dataEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"edits":' } }] } }] }),
      dataEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '[{"old_string":"a","new_string":"b"}]}' } }] } }] }),
      dataEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ]);

    expect(toolCalls(await collect(provider))).toEqual([
      { id: "call_1", name: "patch_note", arguments: { edits: [{ old_string: "a", new_string: "b" }] } },
    ]);
  });

  it("assembles multiple parallel tool calls by index", async () => {
    const { provider } = providerFor([
      dataEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "read_note", arguments: "{}" } },
                { index: 1, id: "b", function: { name: "rewrite_note", arguments: '{"content":"x"}' } },
              ],
            },
          },
        ],
      }),
      dataEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
    ]);

    expect(toolCalls(await collect(provider)).map((c) => c.name)).toEqual(["read_note", "rewrite_note"]);
  });

  // The three regressions below all silently dropped the tool call, which the
  // loop then read as "the model chose not to edit anything".
  it("still emits the tool call when the provider closes with finish_reason 'stop'", async () => {
    const { provider } = providerFor([
      dataEvent(TOOL_CALL_DELTA),
      dataEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]);
    expect(toolCalls(await collect(provider))).toHaveLength(1);
  });

  it("still emits the tool call when the stream ends with no finish_reason at all", async () => {
    const { provider } = providerFor([dataEvent(TOOL_CALL_DELTA), "data: [DONE]\n\n"]);
    expect(toolCalls(await collect(provider))).toHaveLength(1);
  });

  it("still emits the tool call when the stream just stops mid-flight", async () => {
    const { provider } = providerFor([dataEvent(TOOL_CALL_DELTA)]);
    expect(toolCalls(await collect(provider))).toHaveLength(1);
  });

  it("does not emit a duplicate when finish_reason already flushed the buffer", async () => {
    const { provider } = providerFor([
      dataEvent(TOOL_CALL_DELTA),
      dataEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ]);
    expect(toolCalls(await collect(provider))).toHaveLength(1);
  });

  it("surfaces truncated tool-call JSON as empty arguments for the tools to reject", async () => {
    const { provider } = providerFor([
      dataEvent({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "rewrite_note", arguments: '{"content":"unterm' } }] } }],
      }),
      dataEvent({ choices: [{ delta: {}, finish_reason: "length" }] }),
    ]);
    expect(toolCalls(await collect(provider))).toEqual([{ id: "t", name: "rewrite_note", arguments: {} }]);
  });

  it("discards a buffered call that never received a name", async () => {
    const { provider } = providerFor([
      dataEvent({ choices: [{ delta: { tool_calls: [{ index: 0, id: "x", function: { arguments: "{}" } }] } }] }),
    ]);
    expect(toolCalls(await collect(provider))).toHaveLength(0);
  });
});

describe("OpenRouterProvider request shaping", () => {
  it("puts the system prompt first and maps tool-call round trips to the OpenAI shape", async () => {
    const { provider, sentBody } = providerFor(["data: [DONE]\n\n"]);
    await collect(provider, [
      { role: "user", content: "make it a list" },
      { role: "assistant", toolCalls: [{ id: "c1", name: "rewrite_note", arguments: { content: "- a" } }] },
      { role: "tool", toolCallId: "c1", content: '{"ok":true}' },
    ]);

    expect(sentBody().messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "make it a list" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "rewrite_note", arguments: '{"content":"- a"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
    ]);
  });

  it("omits the tools key entirely when no tools are offered", async () => {
    const { provider, sentBody } = providerFor(["data: [DONE]\n\n"]);
    await collect(provider);
    expect(sentBody()).not.toHaveProperty("tools");
    expect(sentBody().stream).toBe(true);
  });
});

describe("OpenRouterProvider error mapping", () => {
  it.each([
    [401, "auth"],
    [402, "insufficient_credits"],
    [429, "rate_limit"],
    [404, "not_found"],
    [500, "unknown"],
  ])("maps HTTP %i to kind '%s'", async (status, kind) => {
    const events = await collect(failingProvider(status, JSON.stringify({ error: { message: "upstream says no" } })));
    expect(events).toEqual([{ type: "error", error: { kind, message: "upstream says no", status } }]);
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    const events = await collect(failingProvider(503, "<html>gateway timeout</html>"));
    expect(events[0]).toMatchObject({ type: "error", error: { kind: "unknown", status: 503 } });
    expect((events[0] as { error: { message: string } }).error.message).toContain("503");
  });

  it("reports a network failure rather than throwing", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
    });
    expect(await collect(provider)).toEqual([
      { type: "error", error: { kind: "network", message: "Network request failed" } },
    ]);
  });

  it("reports an aborted request as a cancellation, not a network fault", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
    });
    const events = await collect(provider);
    expect(events).toEqual([{ type: "error", error: { kind: "cancelled", message: "The request was cancelled." } }]);
  });

  it("reports a cancellation whose error name is not AbortError, using the signal", async () => {
    // The regression: expo/fetch's exception name matches nothing, so a
    // name-only check reported this as a network fault and the editor showed
    // the raw native message for something the user did deliberately.
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetch: async () => {
        throw expoCancellation();
      },
    });

    expect(await collectWith(provider, controller.signal)).toEqual([
      { type: "error", error: { kind: "cancelled", message: "The request was cancelled." } },
    ]);
  });

  it("reports an abort part-way through the stream as a cancellation", async () => {
    // parseSse lets a rejected read escape so it can be classified here. Before
    // this was caught, the exception propagated out of runTurn entirely.
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetch: async () =>
        new Response(
          erroringStream([dataEvent({ choices: [{ delta: { content: "half a rep" } }] })], expoCancellation()),
          { status: 200 },
        ),
    });

    const events = await collectWith(provider, controller.signal);
    expect(textOf(events)).toBe("half a rep");
    expect(events.at(-1)).toEqual({
      type: "error",
      error: { kind: "cancelled", message: "The request was cancelled." },
    });
  });

  it("reports a mid-stream failure that is not an abort as a network error", async () => {
    const provider = new OpenRouterProvider({
      apiKey: "k",
      model: "m",
      fetch: async () =>
        new Response(erroringStream([dataEvent({ choices: [{ delta: { content: "hi" } }] })], new Error("socket died")), {
          status: 200,
        }),
    });

    const events = await collectWith(provider, new AbortController().signal);
    expect(events.at(-1)).toEqual({ type: "error", error: { kind: "network", message: "socket died" } });
  });

  it("forwards the abort signal and auth header to fetch", async () => {
    const controller = new AbortController();
    let seenInit: RequestInit | undefined;
    const provider = new OpenRouterProvider({
      apiKey: "secret-key",
      model: "m",
      fetch: async (_url, init) => {
        seenInit = init;
        return new Response(streamOf(["data: [DONE]\n\n"]), { status: 200 });
      },
    });

    for await (const _ of provider.send({ system: "s", messages: [], tools: [], signal: controller.signal })) {
      // drain
    }

    expect(seenInit?.signal).toBe(controller.signal);
    expect((seenInit?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });
});
