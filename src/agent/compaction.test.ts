import { AGENT_CONFIG } from "./config";
import { compact } from "./compaction";
import { estimateTokens } from "./tokens";
import { CanonicalMessage, Provider, ProviderRequest, ProviderStreamEvent } from "./types";

function provider(handler: (req: ProviderRequest) => AsyncIterable<ProviderStreamEvent>): Provider {
  return { id: "test", send: handler };
}

function bigHistory(count: number, contentLength: number): CanonicalMessage[] {
  return Array.from({ length: count }, (): CanonicalMessage => ({ role: "user", content: "x".repeat(contentLength) }));
}

describe("compact", () => {
  it("collapses history into a single summarized message on success", async () => {
    const history = bigHistory(5, 100);
    const summarizer = provider(async function* () {
      yield { type: "text", delta: "User asked to reformat as a list; done." };
    });

    const result = await compact(history, summarizer);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect((result[0] as { content: string }).content).toContain("[Prior session context, summarized]");
    expect((result[0] as { content: string }).content).toContain("User asked to reformat as a list; done.");
  });

  it("falls back to dropping the oldest messages if summarization errors, without throwing", async () => {
    const history = bigHistory(50, 5000); // ~62,500 estimated tokens, over threshold
    const failingSummarizer = provider(async function* () {
      yield { type: "error", error: { kind: "unknown", message: "model refused" } };
    });

    const result = await compact(history, failingSummarizer);

    expect(result.length).toBeLessThan(history.length);
    expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(AGENT_CONFIG.COMPACT_THRESHOLD_TOKENS);
  });

  it("falls back to dropping the oldest messages if the summary is empty", async () => {
    const history = bigHistory(50, 5000);
    const emptySummarizer = provider(async function* () {
      yield { type: "text", delta: "   " };
    });

    const result = await compact(history, emptySummarizer);

    expect(result.length).toBeLessThan(history.length);
  });

  it("never drops below a single group even if still over threshold", async () => {
    const history = bigHistory(2, 1_000_000); // wildly over threshold, can't shrink below 1
    const failingSummarizer = provider(async function* () {
      throw new Error("network down");
    });

    const result = await compact(history, failingSummarizer);

    expect(result.length).toBe(1);
  });
});

/**
 * The drop-oldest fallback runs precisely when summarization has already failed,
 * so it must produce a list that is still valid to send. Shifting messages one
 * at a time used to split an assistant `toolCalls` message from the `tool`
 * results answering it, which OpenAI-shaped APIs reject with a 400 — turning the
 * safety net into a second, harder failure.
 */
describe("compact fallback message validity", () => {
  const failing = provider(async function* () {
    throw new Error("summarization unavailable");
  });

  /** One tool-call round trip, sized so a few of them blow past the threshold. */
  function toolRoundTrip(index: number, contentLength: number): CanonicalMessage[] {
    return [
      { role: "user", content: `request ${index}` },
      {
        role: "assistant",
        toolCalls: [{ id: `call_${index}`, name: "rewrite_note", arguments: { content: "x".repeat(contentLength) } }],
      },
      { role: "tool", toolCallId: `call_${index}`, content: '{"ok":true}' },
      { role: "assistant", content: `done ${index}` },
    ];
  }

  function orphanedToolResults(messages: CanonicalMessage[]): CanonicalMessage[] {
    return messages.filter((message, i) => {
      if (message.role !== "tool") return false;
      const previous = messages[i - 1];
      if (previous === undefined) return true;
      const answersACall = previous.role === "assistant" && "toolCalls" in previous;
      const continuesABatch = previous.role === "tool";
      return !answersACall && !continuesABatch;
    });
  }

  it("never strands a tool result without the assistant message that requested it", async () => {
    const history = Array.from({ length: 12 }, (_, i) => toolRoundTrip(i, 20_000)).flat();

    const result = await compact(history, failing);

    expect(result.length).toBeLessThan(history.length);
    expect(orphanedToolResults(result)).toEqual([]);
    expect(estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(AGENT_CONFIG.COMPACT_THRESHOLD_TOKENS);
  });

  it("never begins the surviving history with a tool result", async () => {
    const history = Array.from({ length: 12 }, (_, i) => toolRoundTrip(i, 20_000)).flat();

    const result = await compact(history, failing);

    expect(result[0]?.role).not.toBe("tool");
  });

  it("keeps a parallel tool-call batch together with its assistant message", async () => {
    const history: CanonicalMessage[] = [
      { role: "user", content: "x".repeat(300_000) },
      {
        role: "assistant",
        toolCalls: [
          { id: "a", name: "read_note", arguments: {} },
          { id: "b", name: "read_note", arguments: { offset: 100 } },
        ],
      },
      { role: "tool", toolCallId: "a", content: "first" },
      { role: "tool", toolCallId: "b", content: "second" },
      { role: "user", content: "now edit it" },
    ];

    const result = await compact(history, failing);

    expect(orphanedToolResults(result)).toEqual([]);
    // The oversized user turn is what has to go; the round trip stays intact.
    expect(result.some((m) => m.role === "tool" && m.toolCallId === "a")).toBe(true);
    expect(result.some((m) => m.role === "tool" && m.toolCallId === "b")).toBe(true);
  });
});
