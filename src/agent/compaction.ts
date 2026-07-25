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

/**
 * Groups messages so a tool-call round trip stays indivisible: an assistant
 * message carrying `toolCalls` travels with the `tool` results that answer it.
 * Dropping one without the other produces a message list that OpenAI-shaped
 * APIs reject outright ("a tool message must follow an assistant message with
 * tool_calls"), which would turn this fallback into a hard failure.
 */
function groupMessages(messages: CanonicalMessage[]): CanonicalMessage[][] {
  const groups: CanonicalMessage[][] = [];

  for (const message of messages) {
    const isToolResult = message.role === "tool";
    const previousGroup = groups[groups.length - 1];
    const previousOpensToolCalls =
      previousGroup !== undefined &&
      previousGroup[0].role === "assistant" &&
      "toolCalls" in previousGroup[0];

    if (isToolResult && previousOpensToolCalls) {
      previousGroup.push(message);
    } else {
      groups.push([message]);
    }
  }

  return groups;
}

/**
 * Last-resort shrink when summarization itself fails. Drops whole groups from
 * the front so the surviving list is always a valid request, and never strands
 * a `tool` result at the head of the conversation.
 */
function dropOldest(messages: CanonicalMessage[]): CanonicalMessage[] {
  const groups = groupMessages(messages);

  while (groups.length > 1 && estimateTokens(JSON.stringify(groups.flat())) > AGENT_CONFIG.COMPACT_THRESHOLD_TOKENS) {
    groups.shift();
  }

  // Defensive: group-wise dropping can't strand a tool result, but an input
  // list that already began with one would still be invalid to send.
  const kept = groups.flat();
  const firstSendable = kept.findIndex((m) => m.role !== "tool");
  return firstSendable === -1 ? [] : kept.slice(firstSendable);
}
