import { Directory, File, Paths } from "expo-file-system";
import { ulid } from "ulid";
import { deriveTitleAndPreview } from "./title";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type NoteSummary = {
  id: string;
  title: string;
  preview: string;
  modifiedAt: number;
};

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

/** Flat, reverse-chronological by modification time (PRD §5, §7.1). */
export function listNotes(): NoteSummary[] {
  return notesDir()
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(".md"))
    .map((file) => {
      const { title, preview } = deriveTitleAndPreview(file.textSync());
      return { id: file.name.replace(/\.md$/, ""), title, preview, modifiedAt: file.lastModified ?? 0 };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export function createNote(): string {
  const id = ulid();
  noteFile(id).create();
  return id;
}

export function readNote(id: string): string {
  return noteFile(id).textSync();
}

export function writeNote(id: string, content: string): void {
  noteFile(id).write(content);
}

/** Moves to `.trash` rather than deleting outright — recovered by undo snackbar, purged after 30 days. */
export function deleteNote(id: string): void {
  noteFile(id).moveSync(trashDir());
}

export function restoreNote(id: string): void {
  const trashedFile = new File(trashDir(), `${id}.md`);
  trashedFile.moveSync(notesDir());
}

/** Call opportunistically on app start (PRD §5). Uses each file's lastModified as a proxy for deletion time. */
export function purgeExpiredTrash(now: number = Date.now()): void {
  for (const entry of trashDir().list()) {
    if (entry instanceof File && now - (entry.lastModified ?? now) > TRASH_RETENTION_MS) {
      entry.delete();
    }
  }
}
