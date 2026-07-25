/**
 * The inference providers Settings shows a key field for. All four are always
 * present — there is no add/remove.
 *
 * `catalogueAuth` exists because the four disagree about how a key travels: a
 * bearer token for the OpenAI-shaped two, `x-api-key` plus a version header for
 * Anthropic, and `x-goog-api-key` for Gemini. Getting this wrong reads as an
 * auth failure rather than a wiring mistake, so it's declared rather than
 * guessed at the call site.
 */
export type ProviderId = "openrouter" | "openai" | "anthropic" | "google";

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  /** Shown in the key field before anything is typed, so the expected shape is obvious. */
  keyPlaceholder: string;
  /** Catalogue endpoint, or null when the provider publishes no list. */
  modelsUrl: string | null;
  /** How the key is presented to the catalogue endpoint. */
  catalogueAuth: "bearer" | "anthropic" | "google";
  /** Whether the catalogue can be read without a key. Only OpenRouter's can. */
  catalogueNeedsKey: boolean;
};

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-…",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    catalogueAuth: "bearer",
    catalogueNeedsKey: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    keyPlaceholder: "sk-…",
    modelsUrl: "https://api.openai.com/v1/models",
    catalogueAuth: "bearer",
    catalogueNeedsKey: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyPlaceholder: "sk-ant-…",
    modelsUrl: "https://api.anthropic.com/v1/models",
    catalogueAuth: "anthropic",
    catalogueNeedsKey: true,
  },
  {
    id: "google",
    label: "Google Gemini",
    keyPlaceholder: "AIza…",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    catalogueAuth: "google",
    catalogueNeedsKey: true,
  },
];

export function describeProvider(id: ProviderId): ProviderDescriptor {
  const found = PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDERS.some((provider) => provider.id === value);
}
