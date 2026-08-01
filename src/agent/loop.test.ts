import { AGENT_CONFIG } from "./config";
import { runTurn, TURN_TIMEOUT } from "./loop";
import { InMemoryNoteStore, NoteStore, NoteStoreError } from "./noteStore";
import { ScriptedProvider } from "./providers/mock";
import { CanonicalMessage, Provider, ToolCall } from "./types";

function toolCall(name: string, args: Record<string, unknown>, id = "call_1"): ToolCall {
  return { id, name, arguments: args };
}

describe("runTurn", () => {
  it("executes a single tool call then returns the model's final text", async () => {
    const store = new InMemoryNoteStore("original body");
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("rewrite_note", { content: "edited body" }) }],
      [{ type: "text", delta: "Rewrote the note." }],
    ]);

    const result = await runTurn({
      prompt: "rewrite this",
      noteTitle: "Untitled",
      store,
      history: [],
      provider,
    });

    expect(store.read()).toBe("edited body");
    expect(result.bodyChanged).toBe(true);
    expect(result.newBody).toBe("edited body");
    expect(result.finalText).toBe("Rewrote the note.");
    expect(result.stoppedReason).toBe("completed");
    expect(result.toolCallsExecuted).toBe(1);
  });

  describe("onNoteWritten", () => {
    it("reports each write separately, with the body either side of it", async () => {
      const store = new InMemoryNoteStore("one");
      const provider = new ScriptedProvider([
        [{ type: "toolCall", call: toolCall("rewrite_note", { content: "one two" }, "call_1") }],
        [{ type: "toolCall", call: toolCall("rewrite_note", { content: "one two three" }, "call_2") }],
        [{ type: "text", delta: "Done." }],
      ]);
      const writes: [string, string][] = [];

      await runTurn({
        prompt: "extend it twice",
        noteTitle: "Untitled",
        store,
        history: [],
        provider,
        onNoteWritten: (before, after) => writes.push([before, after]),
      });

      // Per tool call, not once for the whole turn — otherwise the UI can only
      // highlight the net result and never the intermediate steps.
      expect(writes).toEqual([
        ["one", "one two"],
        ["one two", "one two three"],
      ]);
    });

    it("is not called for a tool that only reads", async () => {
      const store = new InMemoryNoteStore("untouched");
      const provider = new ScriptedProvider([
        [{ type: "toolCall", call: toolCall("read_note", {}, "call_1") }],
        [{ type: "text", delta: "Had a look." }],
      ]);
      const onNoteWritten = jest.fn();

      await runTurn({ prompt: "read it", noteTitle: "Untitled", store, history: [], provider, onNoteWritten });

      expect(onNoteWritten).not.toHaveBeenCalled();
    });

    it("is not called when a write leaves the note identical", async () => {
      const store = new InMemoryNoteStore("same text");
      const provider = new ScriptedProvider([
        [{ type: "toolCall", call: toolCall("rewrite_note", { content: "same text" }, "call_1") }],
        [{ type: "text", delta: "Nothing to do." }],
      ]);
      const onNoteWritten = jest.fn();

      await runTurn({ prompt: "rewrite it the same", noteTitle: "Untitled", store, history: [], provider, onNoteWritten });

      // A highlight over text that didn't change would be a lie.
      expect(onNoteWritten).not.toHaveBeenCalled();
    });

    it("is not called for a write whose arguments were rejected", async () => {
      const store = new InMemoryNoteStore("original");
      const provider = new ScriptedProvider([
        [{ type: "toolCall", call: toolCall("rewrite_note", { content: 42 }, "call_1") }],
        [{ type: "text", delta: "Could not do that." }],
      ]);
      const onNoteWritten = jest.fn();

      await runTurn({ prompt: "break it", noteTitle: "Untitled", store, history: [], provider, onNoteWritten });

      expect(store.read()).toBe("original");
      expect(onNoteWritten).not.toHaveBeenCalled();
    });
  });

  it("chains read_note then rewrite_note across iterations", async () => {
    const store = new InMemoryNoteStore("line one\nline two");
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("read_note", {}, "call_1") }],
      [{ type: "toolCall", call: toolCall("rewrite_note", { content: "line one\nline two\nline three" }, "call_2") }],
      [{ type: "text", delta: "Added a line." }],
    ]);

    const result = await runTurn({
      prompt: "add a line",
      noteTitle: "Untitled",
      store,
      history: [],
      provider,
    });

    expect(store.read()).toBe("line one\nline two\nline three");
    expect(result.toolCallsExecuted).toBe(2);
    expect(result.finalText).toBe("Added a line.");
  });

  it("does not offer patch_note when the note is under the forced-rewrite threshold", async () => {
    const store = new InMemoryNoteStore("short"); // well under FORCE_REWRITE_BELOW_TOKENS
    const provider = new ScriptedProvider([[{ type: "text", delta: "No changes needed." }]]);

    await runTurn({ prompt: "anything", noteTitle: "Untitled", store, history: [], provider });

    const toolNames = provider.requests[0].tools.map((t) => t.name);
    expect(toolNames).toContain("read_note");
    expect(toolNames).toContain("rewrite_note");
    expect(toolNames).not.toContain("patch_note");
  });

  it("offers patch_note once the note is at or above the forced-rewrite threshold", async () => {
    const store = new InMemoryNoteStore("x".repeat(AGENT_CONFIG.FORCE_REWRITE_BELOW_TOKENS * 4 + 100));
    const provider = new ScriptedProvider([[{ type: "text", delta: "ok" }]]);

    await runTurn({ prompt: "anything", noteTitle: "Untitled", store, history: [], provider });

    const toolNames = provider.requests[0].tools.map((t) => t.name);
    expect(toolNames).toContain("patch_note");
  });

  it("reports no change when the model replies with text only", async () => {
    const store = new InMemoryNoteStore("unchanged content");
    const provider = new ScriptedProvider([[{ type: "text", delta: "Nothing to change here." }]]);

    const result = await runTurn({ prompt: "is this fine?", noteTitle: "Untitled", store, history: [], provider });

    expect(result.bodyChanged).toBe(false);
    expect(result.finalText).toBe("Nothing to change here.");
    expect(result.toolCallsExecuted).toBe(0);
  });

  it("stops after MAX_ITERATIONS if the model never converges", async () => {
    const store = new InMemoryNoteStore("body");
    const script = Array.from({ length: AGENT_CONFIG.MAX_ITERATIONS }, (_, i) => [
      { type: "toolCall" as const, call: toolCall("read_note", {}, `call_${i}`) },
    ]);
    const provider = new ScriptedProvider(script);

    const result = await runTurn({ prompt: "loop forever", noteTitle: "Untitled", store, history: [], provider });

    expect(result.stoppedReason).toBe("max_iterations");
    expect(result.finalText).toBe("Stopped after 8 steps.");
    expect(result.toolCallsExecuted).toBe(AGENT_CONFIG.MAX_ITERATIONS);
  });

  it("stops cleanly when the signal is aborted mid-turn", async () => {
    const store = new InMemoryNoteStore("body");
    const controller = new AbortController();
    controller.abort();
    const provider = new ScriptedProvider([[{ type: "text", delta: "too late" }]]);

    const result = await runTurn({
      prompt: "cancel me",
      noteTitle: "Untitled",
      store,
      history: [],
      provider,
      signal: controller.signal,
    });

    expect(result.stoppedReason).toBe("cancelled");
    expect(result.finalText).toBe("Cancelled");
    expect(result.bodyChanged).toBe(false);
  });

  /**
   * The caller reverts the note when a turn aborts, so the history has to be
   * discarded with it — otherwise the two disagree, and the next turn tells the
   * model it made edits that were rolled back underneath it.
   *
   * It also leaves history ending on a `user` message, so the next turn appends
   * a second one. OpenAI-shaped APIs tolerate that; Anthropic rejects it.
   */
  it("discards an aborted turn's history rather than half-recording it", async () => {
    const store = new InMemoryNoteStore("body");
    const controller = new AbortController();
    controller.abort();
    const history: CanonicalMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "earlier reply" },
    ];
    const provider = new ScriptedProvider([[{ type: "text", delta: "too late" }]]);

    const result = await runTurn({
      prompt: "cancel me",
      noteTitle: "Untitled",
      store,
      history,
      provider,
      signal: controller.signal,
    });

    expect(result.updatedHistory).toEqual(history);
    expect(result.updatedHistory.at(-1)).not.toMatchObject({ content: "cancel me" });
  });

  it("throws an AgentProviderError when the provider reports an error", async () => {
    const store = new InMemoryNoteStore("body");
    const provider = new ScriptedProvider([[{ type: "error", error: { kind: "auth", message: "bad key" } }]]);

    await expect(
      runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider }),
    ).rejects.toThrow("bad key");
  });
});

describe("runTurn abort reporting", () => {
  const store = () => new InMemoryNoteStore("body");

  it("reports a deadline abort as timed_out, not as a user cancellation", async () => {
    const controller = new AbortController();
    controller.abort(TURN_TIMEOUT);
    const provider = new ScriptedProvider([[{ type: "text", delta: "too late" }]]);

    const result = await runTurn({
      prompt: "slow request",
      noteTitle: "Untitled",
      store: store(),
      history: [],
      provider,
      signal: controller.signal,
    });

    expect(result.stoppedReason).toBe("timed_out");
    expect(result.finalText).toBe("Timed out");
  });

  /**
   * An abort landing while the request is still opening arrives as an error
   * *event* rather than a thrown AbortError. Both are the same situation, so
   * both must report identically — previously this path raised a provider error
   * reading "The request timed out." at the user who had just pressed cancel.
   */
  it("reports an abort delivered as an error event the same as a thrown abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider: Provider = {
      id: "aborting",
      async *send() {
        yield { type: "error", error: { kind: "cancelled", message: "The request was cancelled." } };
      },
    };

    const result = await runTurn({
      prompt: "cancel me",
      noteTitle: "Untitled",
      store: store(),
      history: [],
      provider,
      signal: controller.signal,
    });

    expect(result.stoppedReason).toBe("cancelled");
    expect(result.finalText).toBe("Cancelled");
  });

  it("still distinguishes a timeout when it arrives as an error event", async () => {
    const controller = new AbortController();
    controller.abort(TURN_TIMEOUT);
    const provider: Provider = {
      id: "aborting",
      async *send() {
        yield { type: "error", error: { kind: "cancelled", message: "The request was cancelled." } };
      },
    };

    const result = await runTurn({
      prompt: "slow",
      noteTitle: "Untitled",
      store: store(),
      history: [],
      provider,
      signal: controller.signal,
    });

    expect(result.stoppedReason).toBe("timed_out");
  });
});

/**
 * Malformed tool arguments are the model's mistake, and the loop's job is to
 * hand the mistake back so it can correct itself. Storage failures are not the
 * model's mistake and must not be papered over as a tool result.
 */
describe("runTurn tool failure handling", () => {
  it("returns a tool error to the model instead of crashing on malformed arguments", async () => {
    const store = new InMemoryNoteStore("the user's real content");
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("rewrite_note", {}) }],
      [{ type: "toolCall", call: toolCall("rewrite_note", { content: "corrected body" }, "call_2") }],
      [{ type: "text", delta: "Fixed it." }],
    ]);

    const result = await runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider });

    expect(result.finalText).toBe("Fixed it.");
    expect(store.read()).toBe("corrected body");

    // The failed call has to reach the model as a tool result, or it has nothing to react to.
    const secondRequest = provider.requests[1];
    const toolResult = secondRequest.messages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    expect((toolResult as { content: string }).content).toContain("content");
  });

  it("leaves the note untouched when every tool call is malformed", async () => {
    const store = new InMemoryNoteStore("untouched");
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("patch_note", { edits: "not an array" }) }],
      [{ type: "text", delta: "I could not apply that." }],
    ]);

    const result = await runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider });

    expect(store.read()).toBe("untouched");
    expect(result.bodyChanged).toBe(false);
    expect(result.stoppedReason).toBe("completed");
  });

  it("returns a tool error for an unknown tool name", async () => {
    const store = new InMemoryNoteStore("body");
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("delete_everything", {}) }],
      [{ type: "text", delta: "That tool does not exist." }],
    ]);

    const result = await runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider });

    expect(result.stoppedReason).toBe("completed");
    expect(store.read()).toBe("body");
  });

  it("propagates a NoteStoreError rather than reporting it to the model as a tool error", async () => {
    const store: NoteStore = {
      read: () => "body",
      write: () => {
        throw new NoteStoreError("Could not save the note: disk full");
      },
    };
    const provider = new ScriptedProvider([
      [{ type: "toolCall", call: toolCall("rewrite_note", { content: "new body" }) }],
      [{ type: "text", delta: "unreachable" }],
    ]);

    await expect(
      runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider }),
    ).rejects.toThrow(NoteStoreError);
  });
});
