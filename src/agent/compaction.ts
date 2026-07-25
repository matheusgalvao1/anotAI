import { AGENT_CONFIG } from "./config";
import { estimateTokens } from "./tokens";
import { CanonicalMessage, Provider } from "./types";

const COMPACTION_SYSTEM_PROMPT = `Summarize this editing session in a few sentences: what the user has asked for so far, and what has already been changed. Write for the agent that will continue this session, not for the user. Do not include the note's content — it will be provided fresh. Be concise.`;

/**
 * Collapses prior turns into a short summary once the context grows past
 * COMPACT_THRESHOLD_TOKENS (PRD §6.7). Compaction failure must never fail the
 * user's turn, so a summarization error falls back to dropping the oldest
 * messages instead of throwing.
 */
export async function compact(messages: CanonicalMessage[], provider: Provider): Promise<CanonicalMessage[]> {
  try {
    const summary = await summarize(messages, provider);
    return [{ role: "user", content: `[Prior session context, summarized]\n${summary}` }];
  } catch {
    return dropOldest(messages);
  }
}

async function summarize(messages: CanonicalMessage[], provider: Provider): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_CONFIG.REQUEST_TIMEOUT_MS);

  try {
    let text = "";
    const stream = provider.send({
      system: COMPACTION_SYSTEM_PROMPT,
      messages,
      tools: [],
      signal: controller.signal,
    });

    for await (const event of stream) {
      if (event.type === "text") text += event.delta;
      if (event.type === "error") throw new Error(event.error.message);
    }

    if (!text.trim()) throw new Error("compaction produced an empty summary");
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function dropOldest(messages: CanonicalMessage[]): CanonicalMessage[] {
  const kept = [...messages];
  while (kept.length > 1 && estimateTokens(JSON.stringify(kept)) > AGENT_CONFIG.COMPACT_THRESHOLD_TOKENS) {
    kept.shift();
  }
  return kept;
}
