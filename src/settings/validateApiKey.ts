import { ProviderError, READ_NOTE_SCHEMA } from "../agent";
import { buildProvider } from "./buildProvider";
import { describeProvider, ProviderId } from "./providers";

export type ValidationResult = { ok: true } | { ok: false; message: string };

const VALIDATION_TIMEOUT_MS = 15_000;

function describeValidationError(error: ProviderError, provider: string): string {
  switch (error.kind) {
    case "no_tool_support":
      return `This model can't edit notes — it doesn't support tool calling. Pick another. (${error.message})`;
    case "auth":
      return `${provider} rejected this key.`;
    case "not_found":
      return `${provider} doesn't have that model. (${error.message})`;
    default:
      return error.message;
  }
}

/**
 * One cheap request to confirm a key/model pair actually works (PRD §7.7).
 *
 * **The request carries a tool**, which is the whole point of validating rather
 * than just pinging. Every turn this app runs is a tool-calling turn, and
 * "answers a plain question" does not imply "accepts a tool": OpenAI's reasoning
 * models reply to text happily and reject function tools on
 * /v1/chat/completions outright. Validating without one passed those models and
 * left the failure to land later, on the first edit the user asked for.
 *
 * The model is not asked to *call* the tool — only to accept a request carrying
 * one — so either text or a tool call counts as a working pair.
 */
export async function validateApiKey(providerId: ProviderId, apiKey: string, model: string): Promise<ValidationResult> {
  const provider = buildProvider(providerId, apiKey, model);
  const label = describeProvider(providerId).label;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    let sawOutput = false;
    for await (const event of provider.send({
      system: "Reply with a single word.",
      messages: [{ role: "user", content: "Reply with: ok" }],
      tools: [READ_NOTE_SCHEMA],
      signal: controller.signal,
    })) {
      if (event.type === "text" && event.delta.length > 0) sawOutput = true;
      if (event.type === "toolCall") sawOutput = true;
      if (event.type === "error") return { ok: false, message: describeValidationError(event.error, label) };
    }
    return sawOutput ? { ok: true } : { ok: false, message: "The model returned an empty response." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Validation failed." };
  } finally {
    clearTimeout(timeout);
  }
}
