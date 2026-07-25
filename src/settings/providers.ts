/**
 * The inference providers the app knows how to talk to.
 *
 * Only OpenRouter has an adapter today (PRD §14.1), but everything downstream —
 * storage, the model catalogue, the Settings UI — is keyed by provider id rather
 * than assuming one, so adding a second provider is an entry here plus an
 * adapter, not a rewrite.
 */
export type ProviderId = "openrouter";

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  /** Shown in the key field before anything is typed, so the expected shape is obvious. */
  keyPlaceholder: string;
  /** Where to get a key, for someone who doesn't have one yet. */
  keyHint: string;
  /** Catalogue endpoint. Reachable without a key for OpenRouter. */
  modelsUrl: string;
};

export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyPlaceholder: "sk-or-v1-…",
    keyHint: "Create a key at openrouter.ai/keys.",
    modelsUrl: "https://openrouter.ai/api/v1/models",
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
