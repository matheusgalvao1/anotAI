import AsyncStorage from "@react-native-async-storage/async-storage";
import { describeProvider, ProviderId } from "./providers";
import { CatalogueModel, parseOpenRouterModels } from "./modelList";

const CACHE_KEY_PREFIX = "modelCatalogue:";
const FETCH_TIMEOUT_MS = 15_000;

async function readCache(providerId: ProviderId): Promise<CatalogueModel[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY_PREFIX + providerId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CatalogueModel[]) : null;
  } catch {
    return null;
  }
}

async function writeCache(providerId: ProviderId, models: CatalogueModel[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + providerId, JSON.stringify(models));
  } catch {
    // A cache that can't be written is not worth failing a fetch over.
  }
}

export type CatalogueResult = {
  models: CatalogueModel[];
  /** True when the list came from cache because the network didn't answer. */
  stale: boolean;
  /** Non-null when nothing could be loaded at all, so the UI can offer typing instead. */
  error: string | null;
};

/**
 * The catalogue for one provider, preferring fresh data and falling back to the
 * last known list.
 *
 * Settings has to stay usable offline, and the catalogue changes slowly, so a
 * stale list beats an empty one. When there's no cache either, the caller is
 * told so it can fall back to a free-text field — being unable to reach the
 * network must never leave someone unable to set a model.
 */
export async function loadModels(providerId: ProviderId, apiKey: string | null): Promise<CatalogueResult> {
  const cached = await readCache(providerId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(describeProvider(providerId).modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`The provider returned HTTP ${response.status}.`);

    const models = parseOpenRouterModels(await response.json());
    if (models.length === 0) throw new Error("The provider returned no tool-calling models.");

    await writeCache(providerId, models);
    return { models, stale: false, error: null };
  } catch (err) {
    if (cached && cached.length > 0) return { models: cached, stale: true, error: null };
    return {
      models: [],
      stale: false,
      error: err instanceof Error ? err.message : "Could not load the model list.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
