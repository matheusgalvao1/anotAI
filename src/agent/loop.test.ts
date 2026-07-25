import { AGENT_CONFIG } from "./config";
import { runTurn } from "./loop";
import { InMemoryNoteStore } from "./noteStore";
import { ScriptedProvider } from "./providers/mock";
import { ToolCall } from "./types";

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

  it("throws an AgentProviderError when the provider reports an error", async () => {
    const store = new InMemoryNoteStore("body");
    const provider = new ScriptedProvider([[{ type: "error", error: { kind: "auth", message: "bad key" } }]]);

    await expect(
      runTurn({ prompt: "edit", noteTitle: "Untitled", store, history: [], provider }),
    ).rejects.toThrow("bad key");
  });
});
