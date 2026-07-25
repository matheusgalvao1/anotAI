import { Provider, ProviderRequest, ProviderStreamEvent } from "../types";
import { OpenAiCompatibleProvider } from "./openaiCompatible";
import { FetchLike } from "./transport";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterProviderOptions = {
  apiKey: string;
  model: string;
  /** Sent as HTTP-Referer / X-Title per OpenRouter's attribution convention. No user identifiers. */
  referer?: string;
  title?: string;
  /**
   * Streaming-capable fetch. **The app must pass `expo/fetch` explicitly**
   * (PRD §10 tech stack) — do not rely on the ambient global. React Native's
   * own `fetch` is `whatwg-fetch` over XHR and its `Response` has no `body`
   * property at all, so SSE cannot be read from it. Expo SDK 57 happens to
   * replace `globalThis.fetch` with its streaming implementation, but that is
   * an implicit side effect gated on `EXPO_PUBLIC_USE_RN_FETCH`, and this
   * module is framework-free and may run outside the Expo runtime. Defaults to
   * `globalThis.fetch` only as a convenience for Node-side tests.
   */
  fetch?: FetchLike;
};

/**
 * OpenRouter, which is an OpenAI-compatible endpoint — so this is the shared
 * chat-completions implementation plus OpenRouter's attribution headers.
 *
 * Kept as its own class rather than a bare factory call because it is the one
 * provider verified against a live API (`providers.live.test.ts`), and because
 * the attribution headers are specific to it.
 */
export class OpenRouterProvider implements Provider {
  readonly id = "openrouter";
  private inner: OpenAiCompatibleProvider;

  constructor(opts: OpenRouterProviderOptions) {
    this.inner = new OpenAiCompatibleProvider({
      id: "openrouter",
      url: OPENROUTER_URL,
      displayName: "OpenRouter",
      apiKey: opts.apiKey,
      model: opts.model,
      extraHeaders: {
        ...(opts.referer ? { "HTTP-Referer": opts.referer } : {}),
        ...(opts.title ? { "X-Title": opts.title } : {}),
      },
      fetch: opts.fetch,
    });
  }

  send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    return this.inner.send(req);
  }
}

// Re-exported so existing importers keep working after the transport types moved
// into their own module.
export type { FetchLike, FetchLikeInit, FetchLikeResponse } from "./transport";
