import * as SecureStore from "expo-secure-store";
import { ModelSelection, parseSelection } from "./modelSelection";
import { ProviderId } from "./providers";

// Naming matches the <PROVIDER>_API_KEY convention from .env.example
// (PRD §14.1) — dev/test tooling reads env vars, the shipped app reads the OS
// keychain. Never the reverse (PRD §8).
//
// That convention is why keys need no migration: the single key this app used to
// store already lived at OPENROUTER_API_KEY, which is exactly what
// `keyStorageKey("openrouter")` produces.
function keyStorageKey(providerId: ProviderId): string {
  return `${providerId.toUpperCase()}_API_KEY`;
}

const SELECTED_MODEL_STORAGE_KEY = "SELECTED_MODEL";
/** What the model used to be stored under, before a selection knew its provider. */
const LEGACY_MODEL_STORAGE_KEY = "OPENROUTER_DEFAULT_MODEL";

export async function getProviderKey(providerId: ProviderId): Promise<string | null> {
  return SecureStore.getItemAsync(keyStorageKey(providerId));
}

export async function setProviderKey(providerId: ProviderId, key: string): Promise<void> {
  await SecureStore.setItemAsync(keyStorageKey(providerId), key);
}

export async function clearProviderKey(providerId: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyStorageKey(providerId));
}

export async function getSelectedModel(): Promise<ModelSelection | null> {
  const stored = await SecureStore.getItemAsync(SELECTED_MODEL_STORAGE_KEY);
  const parsed = parseSelection(stored);
  if (parsed) return parsed;

  // Read-through fallback, not a destructive migration: someone upgrading with a
  // model already set keeps it, and nothing is deleted in case they downgrade.
  const legacy = await SecureStore.getItemAsync(LEGACY_MODEL_STORAGE_KEY);
  return legacy && legacy.length > 0 ? { providerId: "openrouter", modelId: legacy } : null;
}

export async function setSelectedModel(selection: ModelSelection): Promise<void> {
  await SecureStore.setItemAsync(SELECTED_MODEL_STORAGE_KEY, JSON.stringify(selection));
}

export async function clearSelectedModel(): Promise<void> {
  await SecureStore.deleteItemAsync(SELECTED_MODEL_STORAGE_KEY);
}

export type { ModelSelection };
