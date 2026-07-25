/**
 * Turning a provider's raw catalogue into the list the picker shows.
 *
 * Platform-free on purpose, so it can be tested headless — the fetching and
 * caching around it lives in modelCatalogue.ts, which needs AsyncStorage and
 * therefore a device. Same split as src/notes: pure text logic apart from the
 * filesystem that feeds it.
 */
import { describeProvider, ProviderId } from "./providers";

export type CatalogueModel = {
  id: string;
  /** Human label from the provider, falling back to the id. */
  name: string;
  providerId: ProviderId;
};

export type ModelGroup = { providerId: ProviderId; label: string; models: CatalogueModel[] };

/**
 * Turns OpenRouter's `/models` response into the list worth offering.
 *
 * Filters to models that support tool calling: the agent cannot function
 * without it, so listing the rest would be offering a choice that is already
 * broken. OpenRouter reports this in `supported_parameters`.
 *
 * Tolerant by design — an unexpected entry is skipped rather than failing the
 * whole catalogue, because one malformed row shouldn't cost the user the picker.
 */
export function parseOpenRouterModels(payload: unknown): CatalogueModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const models: CatalogueModel[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, supported_parameters: supported } = entry as {
      id?: unknown;
      name?: unknown;
      supported_parameters?: unknown;
    };
    if (typeof id !== "string" || id.length === 0) continue;
    if (!Array.isArray(supported) || !supported.includes("tools")) continue;
    models.push({ id, name: typeof name === "string" && name.length > 0 ? name : id, providerId: "openrouter" });
  }
  return models;
}

/**
 * Groups by provider and sorts alphabetically within each group, so a long list
 * is scannable. Case-insensitive, since model names are inconsistently
 * capitalised across vendors and a naive sort scatters them.
 */
export function groupModels(models: CatalogueModel[]): ModelGroup[] {
  const byProvider = new Map<ProviderId, CatalogueModel[]>();
  for (const model of models) {
    const existing = byProvider.get(model.providerId);
    if (existing) existing.push(model);
    else byProvider.set(model.providerId, [model]);
  }

  return [...byProvider.entries()]
    .map(([providerId, group]) => ({
      providerId,
      label: describeProvider(providerId).label,
      models: [...group].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}
