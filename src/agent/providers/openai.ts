import { Provider, ProviderRequest, ProviderStreamEvent } from "../types";
import { OpenAiCompatibleProvider } from "./openaiCompatible";
import { FetchLike } from "./transport";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type OpenAiProviderOptions = {
  apiKey: string;
  model: string;
  /** See OpenRouterProviderOptions — must be `expo/fetch` in the app. */
  fetch?: FetchLike;
};

/**
 * OpenAI's own chat-completions endpoint.
 *
 * Identical protocol to OpenRouter, so this is the shared implementation with a
 * different URL and no attribution headers. Anything true of OpenRouter's SSE
 * handling — fragmented events, tool calls assembled by index, finish_reason
 * variance — is true here by construction rather than by duplication.
 */
export class OpenAiProvider implements Provider {
  readonly id = "openai";
  private inner: OpenAiCompatibleProvider;

  constructor(opts: OpenAiProviderOptions) {
    this.inner = new OpenAiCompatibleProvider({
      id: "openai",
      url: OPENAI_URL,
      displayName: "OpenAI",
      apiKey: opts.apiKey,
      model: opts.model,
      fetch: opts.fetch,
    });
  }

  send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    return this.inner.send(req);
  }
}
