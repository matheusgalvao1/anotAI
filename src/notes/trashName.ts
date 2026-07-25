/**
 * Trashed notes carry their deletion time in the filename.
 *
 * The obvious alternative — a file's own `lastModified` — is not usable as a
 * proxy for "when was this deleted", because moving a file preserves its mtime.
 * A note last edited five weeks ago would have been eligible for purging the
 * instant it was trashed, silently discarding it instead of holding it for the
 * 30-day window the app promises (PRD §5).
 */

const TRASHED_NAME = /^(?<id>.+)\.deleted-(?<deletedAt>\d+)\.md$/;

export function trashedName(id: string, deletedAt: number): string {
  return `${id}.deleted-${deletedAt}.md`;
}

/** Returns null for anything not written by {@link trashedName} — unrecognised files are left alone, never guessed at. */
export function parseTrashedName(fileName: string): { id: string; deletedAt: number } | null {
  const groups = TRASHED_NAME.exec(fileName)?.groups;
  if (!groups) return null;

  const deletedAt = Number(groups.deletedAt);
  if (!Number.isSafeInteger(deletedAt)) return null;

  return { id: groups.id, deletedAt };
}

export function isExpired(deletedAt: number, now: number, retentionMs: number): boolean {
  return now - deletedAt > retentionMs;
}
