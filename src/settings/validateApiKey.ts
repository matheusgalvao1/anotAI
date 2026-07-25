import { fetch as expoFetch } from "expo/fetch";
import { OpenRouterProvider } from "../agent";

export type ValidationResult = { ok: true } | { ok: false; message: string };

const VALIDATION_TIMEOUT_MS = 15_000;

/** One cheap request to confirm a key/model pair actually works (PRD §7.7). */
export async function validateApiKey(apiKey: string, model: string): Promise<ValidationResult> {
  // `fetch` is injected for the same reason useAgentTurn injects it: RN's own
  // fetch exposes no streaming body, and relying on Expo's global replacement is
  // an invisible dependency the agent core must not carry (see AGENTS.md).
  const provider = new OpenRouterProvider({ apiKey, model, title: "anotAI", fetch: expoFetch });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    let sawText = false;
    for await (const event of provider.send({
      system: "Reply with a single word.",
      messages: [{ role: "user", content: "Reply with: ok" }],
      tools: [],
      signal: controller.signal,
    })) {
      if (event.type === "text" && event.delta.length > 0) sawText = true;
      if (event.type === "error") return { ok: false, message: event.error.message };
    }
    return sawText ? { ok: true } : { ok: false, message: "The model returned an empty response." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Validation failed." };
  } finally {
    clearTimeout(timeout);
  }
}
