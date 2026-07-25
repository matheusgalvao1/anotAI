/**
 * The inference providers Settings shows a key field for.
 *
 * All four are always present — there is no add/remove — but only the ones with
 * `supported: true` have an adapter behind them, so only those can list models or
 * run a turn. The rest exist so a key can be stored ahead of the adapter landing,
 * and are marked in the UI rather than silently failing (PRD §14.1).
 */
export type ProviderId = "openrouter" | "openai" | "anthropic" | "google";

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  /** Shown in the key field before anything is typed, so the expected shape is obvious. */
  keyPlaceholder: string;
  /** Catalogue endpoint, or null when there's no adapter to read it with yet. */
  modelsUrl: string | null;
  /** Whether a turn can actually run against this provider today. */
  supported: boolean;
};

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-…",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    supported: true,
  },
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-…", modelsUrl: null, supported: false },
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-…", modelsUrl: null, supported: false },
  { id: "google", label: "Google", keyPlaceholder: "AIza…", modelsUrl: null, supported: false },
];

export function describeProvider(id: ProviderId): ProviderDescriptor {
  const found = PROVIDERS.find((provider) => provider.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDERS.some((provider) => provider.id === value);
}
