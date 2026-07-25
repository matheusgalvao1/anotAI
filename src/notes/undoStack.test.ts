import { SnapshotUndoStack } from "./undoStack";

describe("SnapshotUndoStack", () => {
  it("starts with no undo/redo available", () => {
    const stack = new SnapshotUndoStack("hello");
    expect(stack.value).toBe("hello");
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  it("undoes to the previous value and enables redo", () => {
    const stack = new SnapshotUndoStack("a");
    stack.push("b");
    stack.push("c");

    expect(stack.undo()).toBe("b");
    expect(stack.canRedo()).toBe(true);
    expect(stack.undo()).toBe("a");
    expect(stack.canUndo()).toBe(false);
  });

  it("redoes back to a value after an undo", () => {
    const stack = new SnapshotUndoStack("a");
    stack.push("b");
    stack.undo();

    expect(stack.redo()).toBe("b");
    expect(stack.canRedo()).toBe(false);
  });

  it("clears redo history on a new push", () => {
    const stack = new SnapshotUndoStack("a");
    stack.push("b");
    stack.undo();
    stack.push("c");

    expect(stack.canRedo()).toBe(false);
    expect(stack.value).toBe("c");
  });

  it("ignores a push identical to the current value", () => {
    const stack = new SnapshotUndoStack("a");
    stack.push("a");
    expect(stack.canUndo()).toBe(false);
  });

  it("is a no-op to undo with nothing in the past", () => {
    const stack = new SnapshotUndoStack("a");
    expect(stack.undo()).toBe("a");
  });

  it("is a no-op to redo with nothing in the future", () => {
    const stack = new SnapshotUndoStack("a");
    expect(stack.redo()).toBe("a");
  });
});
