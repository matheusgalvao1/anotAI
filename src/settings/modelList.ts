/**
 * Turning a provider's raw catalogue into the list the picker shows.
 *
 * Platform-free on purpose, so it can be tested headless — the fetching and
 * caching around it lives in modelCatalogue.ts, which needs AsyncStorage and
 * therefore a device. Same split as src/notes: pure text logic apart from the
 * filesystem that feeds it.
 */
import { ProviderId } from "./providers";

export type CatalogueModel = {
  id: string;
  /** Human label from the provider, falling back to the id. */
  name: string;
  providerId: ProviderId;
};

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
 * Alphabetical by display name, case-insensitively.
 *
 * Case matters here: vendors capitalise inconsistently, and a naive sort puts
 * every lowercase name after every uppercase one, scattering the list.
 *
 * Grouping by provider used to live here. It went when the picker became
 * provider-then-model: the list only ever shows one provider's models now, so a
 * group label would just repeat the dropdown above it.
 */
export function sortModels(models: CatalogueModel[]): CatalogueModel[] {
  return [...models].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
