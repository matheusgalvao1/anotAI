import { InMemoryNoteStore } from "./noteStore";
import { executePatchNote, executeReadNote, executeRewriteNote, ToolArgError } from "./tools";

/** Asserts a tool call succeeded and narrows away the argument-error variant. */
function unwrap<T extends object>(result: T | ToolArgError): T {
  if ("ok" in result && result.ok === false) {
    throw new Error(`expected a successful tool result, got: ${(result as ToolArgError).error}`);
  }
  return result as T;
}

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
    const result = unwrap(executeReadNote(store, {}));
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
    const result = unwrap(executeRewriteNote(store, { content: "café" }));
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

/**
 * Tool arguments are model output parsed leniently — a truncated stream yields
 * `{}` rather than the declared shape. Before validation existed, that reached
 * the note directly: `rewrite_note` wrote the string "undefined" over the user's
 * work, and `patch_note` threw a TypeError that killed the entire turn and
 * surfaced "Cannot read properties of undefined" as the status line.
 */
describe("malformed tool arguments", () => {
  const ORIGINAL = "the user's real content";

  function store() {
    return new InMemoryNoteStore(ORIGINAL);
  }

  describe("rewrite_note", () => {
    it.each([
      ["no arguments at all", {}],
      ["a non-string content", { content: 42 }],
      ["a null content", { content: null }],
      ["an object content", { content: { text: "hi" } }],
      ["a non-object argument payload", "just a string"],
      ["a null argument payload", null],
    ])("rejects %s without writing", (_label, args) => {
      const s = store();
      const result = executeRewriteNote(s, args);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("content");
      expect(s.read()).toBe(ORIGINAL);
    });

    it("accepts an empty string as a legitimate way to clear the note", () => {
      const s = store();
      expect(executeRewriteNote(s, { content: "" })).toEqual({ ok: true, bytes: 0 });
      expect(s.read()).toBe("");
    });
  });

  describe("patch_note", () => {
    it.each([
      ["a missing edits array", {}],
      ["edits as a string", { edits: "old -> new" }],
      ["edits as an object", { edits: { old_string: "a", new_string: "b" } }],
      ["an empty edits array", { edits: [] }],
      ["an edit that isn't an object", { edits: ["not an object"] }],
      ["an edit missing new_string", { edits: [{ old_string: "the" }] }],
      ["an edit missing old_string", { edits: [{ new_string: "x" }] }],
      ["a non-string old_string", { edits: [{ old_string: 7, new_string: "x" }] }],
      ["a non-boolean replace_all", { edits: [{ old_string: "the", new_string: "x", replace_all: "yes" }] }],
      ["a non-object argument payload", []],
    ])("rejects %s without writing or throwing", (_label, args) => {
      const s = store();
      const result = executePatchNote(s, args);
      expect(result.ok).toBe(false);
      expect(s.read()).toBe(ORIGINAL);
    });

    it("validates every edit before applying any of them", () => {
      const s = store();
      const result = executePatchNote(s, {
        edits: [
          { old_string: "the", new_string: "THE" },
          { old_string: "real", new_string: 99 },
        ],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("edits[1].new_string");
      expect(s.read()).toBe(ORIGINAL);
    });

    it("omits failed_index for an argument error but keeps it for a failed edit", () => {
      const argError = executePatchNote(store(), {});
      const editError = executePatchNote(store(), { edits: [{ old_string: "absent", new_string: "x" }] });
      expect(argError.ok).toBe(false);
      if (!argError.ok) expect(argError.failed_index).toBeUndefined();
      expect(editError.ok).toBe(false);
      if (!editError.ok) expect(editError.failed_index).toBe(0);
    });
  });

  describe("read_note", () => {
    it("tolerates a missing argument payload", () => {
      expect(executeReadNote(store(), undefined)).toMatchObject({ content: ORIGINAL });
    });

    it("coerces numeric strings, which some models emit for number parameters", () => {
      const s = new InMemoryNoteStore("a\nb\nc\nd");
      expect(executeReadNote(s, { offset: "1", limit: "2" })).toMatchObject({ content: "b\nc" });
    });

    it("rejects an unparseable offset rather than silently reading from 0", () => {
      const result = executeReadNote(store(), { offset: "somewhere in the middle" });
      expect("ok" in result && result.ok === false).toBe(true);
    });
  });
});
