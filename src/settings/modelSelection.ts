import { isProviderId, ProviderId } from "./providers";

/** A model and the provider it's served by. Both are needed to run a turn. */
export type ModelSelection = { providerId: ProviderId; modelId: string };

/**
 * Reads a stored selection, treating anything unexpected as "nothing selected".
 *
 * Stored values are untrusted: they can be corrupt, hand-edited, or written by a
 * newer build. Throwing here would happen during Settings' first render and take
 * the screen down with it, so every bad shape has to degrade instead.
 *
 * Platform-free so it can be tested headless — the keychain access that calls it
 * lives in secureSettings.ts.
 */
export function parseSelection(stored: string | null): ModelSelection | null {
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return null;
    const { providerId, modelId } = value as { providerId?: unknown; modelId?: unknown };
    if (!isProviderId(providerId)) return null;
    if (typeof modelId !== "string" || modelId.length === 0) return null;
    return { providerId, modelId };
  } catch {
    return null;
  }
}
