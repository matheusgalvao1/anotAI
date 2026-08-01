export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Opaque per-provider state that must be handed back verbatim when this call
   * is replayed in history. Nothing outside the adapter that produced it may
   * read or depend on the shape — the loop and the tools carry it and no more.
   *
   * It exists because some APIs sign their own tool calls and then reject a
   * conversation that returns the call without the signature: Gemini 3 fails the
   * *next* request with "Function call is missing a thought_signature in
   * functionCall parts", so a signature dropped here breaks the turn one step
   * later, nowhere near the adapter that dropped it. Treat it as required
   * plumbing, not an optimisation.
   */
  providerData?: unknown;
};

export type CanonicalMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant"; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string }>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
};

export type ToolSchema = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "insufficient_credits"
  | "not_found"
  | "no_tool_support"
  /**
   * The request was aborted. A provider only ever sees "the signal fired" and
   * cannot tell a user cancellation from a deadline, so it always reports
   * `cancelled`; distinguishing the two is the caller's job, via the abort
   * reason it passed in (see `TURN_TIMEOUT` in loop.ts).
   */
  | "cancelled"
  | "timeout"
  | "network"
  | "unknown";

export type ProviderError = {
  kind: ProviderErrorKind;
  message: string;
  status?: number;
};

export type ProviderStreamEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; error: ProviderError };

export type ProviderRequest = {
  system: string;
  messages: CanonicalMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
};

/**
 * Everything the agent loop needs from an LLM backend. Four adapters implement
 * it — OpenRouter, OpenAI, Anthropic, Google Gemini (PRD §14.1) — and the loop
 * knows about none of them. A fifth is an additive file, not a loop change.
 */
export interface Provider {
  readonly id: string;
  send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
}
