/**
 * Snapshot-based undo/redo over a single note's body. Pushes are meant to
 * happen at natural pause boundaries (the same debounce that triggers a
 * save), not on every keystroke — PRD §7.6.
 */
export class SnapshotUndoStack {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;

  constructor(initial: string) {
    this.current = initial;
  }

  get value(): string {
    return this.current;
  }

  push(next: string): void {
    if (next === this.current) return;
    this.past.push(this.current);
    this.current = next;
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): string {
    if (this.past.length === 0) return this.current;
    this.future.push(this.current);
    this.current = this.past.pop()!;
    return this.current;
  }

  redo(): string {
    if (this.future.length === 0) return this.current;
    this.past.push(this.current);
    this.current = this.future.pop()!;
    return this.current;
  }
}
