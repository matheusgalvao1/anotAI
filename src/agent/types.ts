export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
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
 * Everything the agent loop needs from an LLM backend. OpenRouter is the only
 * implementation in v1; Anthropic/OpenAI/Google adapters (see PRD §14.1) are
 * additive implementations of this same interface, not loop changes.
 */
export interface Provider {
  readonly id: string;
  send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
}
