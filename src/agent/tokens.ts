/**
 * chars/4 estimate — a guardrail for the compaction and inline-context
 * thresholds, not a billing figure. No tokenizer ships in v1 (PRD §6.3).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
