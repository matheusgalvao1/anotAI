import { NoteStore } from "../agent";
import { readNote, writeNote } from "./noteRepository";

/** Bridges the file-backed repository to the agent core's single-note NoteStore interface. */
export class FileNoteStore implements NoteStore {
  constructor(private noteId: string) {}

  read(): string {
    return readNote(this.noteId);
  }

  write(content: string): void {
    writeNote(this.noteId, content);
  }
}
