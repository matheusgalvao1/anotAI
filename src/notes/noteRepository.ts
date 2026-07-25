import { Directory, File, Paths } from "expo-file-system";
import { ulid } from "ulid";
import { NoteStoreError } from "../agent";
import { deriveTitleAndPreview } from "./title";
import { isExpired, parseTrashedName, trashedName } from "./trashName";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteSummary = {
  id: string;
  title: string;
  preview: string;
  modifiedAt: number;
};

/**
 * Every filesystem call goes through here so a failure becomes a
 * {@link NoteStoreError} with a message worth showing a user, instead of a raw
 * `expo-file-system` string. Silent data loss is the worst outcome in the app
 * (PRD §14 error matrix), so nothing in this module swallows an error — callers
 * are expected to surface what they catch.
 */
function guard<T>(what: string, operation: () => T): T {
  try {
    return operation();
  } catch (err) {
    throw new NoteStoreError(`${what} ${err instanceof Error ? err.message : String(err)}`, err);
  }
}

function notesDir(): Directory {
  const dir = new Directory(Paths.document, "notes");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function trashDir(): Directory {
  const dir = new Directory(notesDir(), ".trash");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function noteFile(id: string): File {
  return new File(notesDir(), `${id}.md`);
}

function findTrashedFile(id: string): File | null {
  for (const entry of trashDir().list()) {
    if (entry instanceof File && parseTrashedName(entry.name)?.id === id) return entry;
  }
  return null;
}

/** Flat, reverse-chronological by modification time (PRD §5, §7.1). */
export function listNotes(): NoteSummary[] {
  return guard("Could not read your notes:", () =>
    notesDir()
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".md"))
      .map((file) => {
        const { title, preview } = deriveTitleAndPreview(file.textSync());
        return { id: file.name.replace(/\.md$/, ""), title, preview, modifiedAt: file.lastModified ?? 0 };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt),
  );
}

export function createNote(): string {
  return guard("Could not create a new note:", () => {
    const id = ulid();
    noteFile(id).create();
    return id;
  });
}

export function readNote(id: string): string {
  return guard("Could not open this note:", () => noteFile(id).textSync());
}

export function writeNote(id: string, content: string): void {
  guard("Could not save this note:", () => noteFile(id).write(content));
}

/** Moves to `.trash` rather than deleting outright — recovered by undo snackbar, purged after 30 days. */
export function deleteNote(id: string, now: number = Date.now()): void {
  guard("Could not delete this note:", () => {
    const file = noteFile(id);
    file.move(new File(trashDir(), trashedName(id, now)));
  });
}

export function restoreNote(id: string): void {
  guard("Could not restore this note:", () => {
    const trashed = findTrashedFile(id);
    if (!trashed) throw new Error("it is no longer in the trash.");
    trashed.move(new File(notesDir(), `${id}.md`));
  });
}

/**
 * Call opportunistically on app start (PRD §5). Purges by the deletion time
 * recorded in the filename; anything unrecognised is left alone rather than
 * guessed at, since guessing wrong here means deleting a user's note.
 */
export function purgeExpiredTrash(now: number = Date.now()): void {
  guard("Could not empty the trash:", () => {
    for (const entry of trashDir().list()) {
      if (!(entry instanceof File)) continue;
      const trashed = parseTrashedName(entry.name);
      if (trashed && isExpired(trashed.deletedAt, now, TRASH_RETENTION_MS)) entry.delete();
    }
  });
}
