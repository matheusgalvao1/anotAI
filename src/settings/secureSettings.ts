import * as SecureStore from "expo-secure-store";

// Naming matches the <PROVIDER>_API_KEY / <PROVIDER>_DEFAULT_MODEL convention
// from .env.example (PRD §14.1) — dev/test tooling reads env vars, the
// shipped app reads the OS keychain. Never the reverse (PRD §8).
const API_KEY_STORAGE_KEY = "OPENROUTER_API_KEY";
const DEFAULT_MODEL_STORAGE_KEY = "OPENROUTER_DEFAULT_MODEL";

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
}

export async function setApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, key);
}

export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
}

export async function getDefaultModel(): Promise<string | null> {
  return SecureStore.getItemAsync(DEFAULT_MODEL_STORAGE_KEY);
}

export async function setDefaultModel(model: string): Promise<void> {
  await SecureStore.setItemAsync(DEFAULT_MODEL_STORAGE_KEY, model);
}
