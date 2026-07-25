import { InMemoryNoteStore } from "./noteStore";
import { executePatchNote, executeReadNote, executeRewriteNote } from "./tools";

describe("read_note", () => {
  it("returns the whole note when under the default limit", () => {
    const store = new InMemoryNoteStore("line1\nline2\nline3");
    const result = executeReadNote(store, {});
    expect(result).toEqual({ content: "line1\nline2\nline3", total_lines: 3, has_more: false });
  });

  it("paginates with offset/limit and reports has_more", () => {
    const store = new InMemoryNoteStore("a\nb\nc\nd\ne");
    const result = executeReadNote(store, { offset: 1, limit: 2 });
    expect(result).toEqual({ content: "b\nc", total_lines: 5, has_more: true });
  });

  it("does not prefix returned lines with line numbers", () => {
    const store = new InMemoryNoteStore("hello world");
    const result = executeReadNote(store, {});
    expect(result.content).toBe("hello world");
  });
});

describe("rewrite_note", () => {
  it("replaces the entire body and reports byte length", () => {
    const store = new InMemoryNoteStore("old content");
    const result = executeRewriteNote(store, { content: "new content" });
    expect(store.read()).toBe("new content");
    expect(result).toEqual({ ok: true, bytes: 11 });
  });

  it("counts multi-byte characters correctly", () => {
    const store = new InMemoryNoteStore("");
    const result = executeRewriteNote(store, { content: "café" });
    expect(result.bytes).toBe(5); // "é" is 2 bytes in UTF-8
  });
});

describe("patch_note", () => {
  it("replaces a unique exact match", () => {
    const store = new InMemoryNoteStore("The quick brown fox.");
    const result = executePatchNote(store, { edits: [{ old_string: "brown", new_string: "red" }] });
    expect(result).toEqual({ ok: true, applied: 1 });
    expect(store.read()).toBe("The quick red fox.");
  });

  it("applies multiple edits in order against the cumulative result", () => {
    const store = new InMemoryNoteStore("one two three");
    const result = executePatchNote(store, {
      edits: [
        { old_string: "one", new_string: "1" },
        { old_string: "three", new_string: "3" },
      ],
    });
    expect(result).toEqual({ ok: true, applied: 2 });
    expect(store.read()).toBe("1 two 3");
  });

  it("errors on a non-unique match without replace_all, and does not write", () => {
    const store = new InMemoryNoteStore("cat cat cat");
    const result = executePatchNote(store, { edits: [{ old_string: "cat", new_string: "dog" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("3 locations");
      expect(result.error).toContain("read_note");
      expect(result.failed_index).toBe(0);
    }
    expect(store.read()).toBe("cat cat cat");
  });

  it("replaces every occurrence when replace_all is set", () => {
    const store = new InMemoryNoteStore("cat cat cat");
    const result = executePatchNote(store, { edits: [{ old_string: "cat", new_string: "dog", replace_all: true }] });
    expect(result).toEqual({ ok: true, applied: 1 });
    expect(store.read()).toBe("dog dog dog");
  });

  it("falls back to a whitespace-normalized match when the exact string isn't found", () => {
    const store = new InMemoryNoteStore("Heading\n\n  Some   text   here.\n");
    const result = executePatchNote(store, { edits: [{ old_string: "Some text here.", new_string: "New text." }] });
    expect(result).toEqual({ ok: true, applied: 1 });
    // The 2 leading spaces before "Some" aren't part of old_string, so they're preserved.
    expect(store.read()).toBe("Heading\n\n  New text.\n");
  });

  it("errors when the string is not found at all, even normalized", () => {
    const store = new InMemoryNoteStore("Nothing matches this.");
    const result = executePatchNote(store, { edits: [{ old_string: "totally absent phrase", new_string: "x" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("was not found");
      expect(result.error).toContain("rewrite_note");
    }
  });

  it("is atomic: if edit 2 of 2 fails, edit 1 is not applied either", () => {
    const store = new InMemoryNoteStore("alpha beta");
    const result = executePatchNote(store, {
      edits: [
        { old_string: "alpha", new_string: "ALPHA" },
        { old_string: "does-not-exist", new_string: "x" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failed_index).toBe(1);
    expect(store.read()).toBe("alpha beta");
  });

  it("rejects an empty old_string", () => {
    const store = new InMemoryNoteStore("some content");
    const result = executePatchNote(store, { edits: [{ old_string: "", new_string: "x" }] });
    expect(result.ok).toBe(false);
    expect(store.read()).toBe("some content");
  });
});
