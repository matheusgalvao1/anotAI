/**
 * Signals that the underlying storage itself failed — a disk write that didn't
 * land, a note file that vanished. This is deliberately NOT treated as a tool
 * error the model can retry: silent data loss is the worst outcome in the app
 * (PRD §14 error matrix), so the loop rethrows it and the UI surfaces it
 * loudly. Tool *argument* problems are the recoverable kind; storage failures
 * are not.
 */
export class NoteStoreError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NoteStoreError";
    this.cause = cause;
  }
}

/**
 * The agent loop's only view of note content. The real implementation reads
 * and writes the on-device .md file (see PRD §5); tests use the in-memory
 * version so the loop and tools run with no filesystem and no simulator.
 *
 * Implementations must throw {@link NoteStoreError} when storage fails, so the
 * loop can tell "the model sent nonsense" apart from "the disk is full".
 */
export interface NoteStore {
  read(): string;
  write(content: string): void;
}

export class InMemoryNoteStore implements NoteStore {
  private content: string;

  constructor(initialContent: string = "") {
    this.content = initialContent;
  }

  read(): string {
    return this.content;
  }

  write(content: string): void {
    this.content = content;
  }
}
