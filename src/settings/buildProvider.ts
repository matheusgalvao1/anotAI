import { fetch as expoFetch } from "expo/fetch";
import { AnthropicProvider, GoogleProvider, OpenAiProvider, OpenRouterProvider, Provider } from "../agent";
import { ProviderId } from "./providers";

/**
 * Chooses the adapter for a provider id.
 *
 * Lives in the app layer, not in `src/agent`, so the dependency runs the right
 * way: the agent core knows nothing about Settings' `ProviderId`, and this knows
 * about both.
 *
 * `expo/fetch` is injected rather than left to `globalThis.fetch`. React
 * Native's own fetch is `whatwg-fetch` over XHR and its `Response` exposes no
 * `body`, so SSE can't be read from it. Expo SDK 57 does swap the global for its
 * streaming implementation, but that's an implicit side effect gated on
 * `EXPO_PUBLIC_USE_RN_FETCH`, and the agent core is deliberately framework-free
 * — it must not depend on an Expo runtime patch it can't see (see AGENTS.md).
 */
export function buildProvider(providerId: ProviderId, apiKey: string, model: string): Provider {
  switch (providerId) {
    case "openrouter":
      // `title` is OpenRouter's attribution convention. No user identifiers.
      return new OpenRouterProvider({ apiKey, model, title: "anotAI", fetch: expoFetch });
    case "openai":
      return new OpenAiProvider({ apiKey, model, fetch: expoFetch });
    case "anthropic":
      return new AnthropicProvider({ apiKey, model, fetch: expoFetch });
    case "google":
      return new GoogleProvider({ apiKey, model, fetch: expoFetch });
  }
}
