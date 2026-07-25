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

  it("never drops below a single message even if still over threshold", async () => {
    const history = bigHistory(2, 1_000_000); // wildly over threshold, can't shrink below 1
    const failingSummarizer = provider(async function* () {
      throw new Error("network down");
    });

    const result = await compact(history, failingSummarizer);

    expect(result.length).toBe(1);
  });
});
