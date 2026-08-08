/// chars/4 estimate — a guardrail for the compaction and inline-context
/// thresholds, not a billing figure. No tokenizer ships in v1.
int estimateTokens(String text) => (text.length / 4).ceil();
