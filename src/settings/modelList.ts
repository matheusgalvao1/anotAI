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

/**
 * Only OpenRouter publishes whether a model supports tool calling
 * (`supported_parameters`), so only its list can be filtered on capability. The
 * other three have to be filtered by id against families known to support tools
 * — an imperfect heuristic, but better than offering a model that fails on its
 * first tool call, and better than listing embedding or audio models that can't
 * hold a conversation at all.
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

/** OpenAI's `/v1/models`: a flat `data` array of ids, with no capability information. */
export function parseOpenAiModels(payload: unknown): CatalogueModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const models: CatalogueModel[] = [];
  for (const entry of data) {
    const id = (entry as { id?: unknown })?.id;
    if (typeof id !== "string" || id.length === 0) continue;
    // The endpoint also lists embeddings, audio, image and moderation models,
    // none of which can run a turn. Without a capability flag, the id is all
    // there is to go on.
    if (!/^(gpt-|o[134])/.test(id)) continue;
    if (/audio|realtime|transcribe|tts|image|embedding|moderation|instruct/.test(id)) continue;
    models.push({ id, name: id, providerId: "openai" });
  }
  return models;
}

/** Anthropic's `/v1/models`: `data` with `id` and `display_name`. Every current Claude model supports tools. */
export function parseAnthropicModels(payload: unknown): CatalogueModel[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];

  const models: CatalogueModel[] = [];
  for (const entry of data) {
    const { id, display_name: display } = (entry as { id?: unknown; display_name?: unknown }) ?? {};
    if (typeof id !== "string" || id.length === 0) continue;
    models.push({
      id,
      name: typeof display === "string" && display.length > 0 ? display : id,
      providerId: "anthropic",
    });
  }
  return models;
}

/**
 * Gemini's `/v1beta/models`: a `models` array whose names are prefixed
 * `models/`, which must be stripped — the generateContent path adds it back, and
 * leaving it produces `models/models/gemini-…`.
 */
export function parseGoogleModels(payload: unknown): CatalogueModel[] {
  const data = (payload as { models?: unknown })?.models;
  if (!Array.isArray(data)) return [];

  const models: CatalogueModel[] = [];
  for (const entry of data) {
    const { name, displayName, supportedGenerationMethods: methods } =
      (entry as { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }) ?? {};
    if (typeof name !== "string" || name.length === 0) continue;
    // Embedding models can't stream a conversation.
    if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
    const id = name.startsWith("models/") ? name.slice("models/".length) : name;
    // Gemini 1.0 predates function calling; the embedding families aren't chat.
    if (!id.startsWith("gemini-") || id.startsWith("gemini-1.0")) continue;
    models.push({
      id,
      name: typeof displayName === "string" && displayName.length > 0 ? displayName : id,
      providerId: "google",
    });
  }
  return models;
}

export function parseModels(providerId: ProviderId, payload: unknown): CatalogueModel[] {
  switch (providerId) {
    case "openrouter":
      return parseOpenRouterModels(payload);
    case "openai":
      return parseOpenAiModels(payload);
    case "anthropic":
      return parseAnthropicModels(payload);
    case "google":
      return parseGoogleModels(payload);
  }
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
