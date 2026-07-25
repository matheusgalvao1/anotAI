/**
 * The agent loop's only view of note content. The real implementation reads
 * and writes the on-device .md file (see PRD §5); tests use the in-memory
 * version so the loop and tools run with no filesystem and no simulator.
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
