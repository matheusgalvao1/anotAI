import { changedRange, isPureDeletion, splitAroundRange } from "./changedRange";

/** The slice the highlight would actually tint, so assertions read as intent. */
function highlighted(before: string, after: string): string | null {
  const range = changedRange(before, after);
  return range === null ? null : after.slice(range.start, range.end);
}

describe("changedRange", () => {
  it("returns null when nothing changed", () => {
    expect(changedRange("same", "same")).toBeNull();
  });

  it("finds an insertion in the middle, widened to whole words", () => {
    // The raw character-level range here is "wo t", because the inserted "two "
    // shares its "t" with "three". Widening to word boundaries costs one
    // unchanged word and is the difference between readable and broken.
    expect(highlighted("one three", "one two three")).toBe("two three");
  });

  it("finds an append", () => {
    expect(highlighted("line one", "line one\nline two")).toBe("\nline two");
  });

  it("finds a prepend", () => {
    expect(highlighted("body", "# Title\n\nbody")).toBe("# Title\n\n");
  });

  it("finds a replacement", () => {
    expect(highlighted("the cat sat", "the dog sat")).toBe("dog");
  });

  it("treats a whole-note rewrite as one span", () => {
    expect(highlighted("old", "completely new")).toBe("completely new");
  });

  it("reports an empty range for a deletion, at the point of removal", () => {
    const range = changedRange("keep this remove me", "keep this ");
    expect(range).toEqual({ start: 10, end: 10 });
    expect(isPureDeletion(range!)).toBe(true);
  });

  it("does not widen a change that already begins at whitespace", () => {
    // Regression: widening unconditionally pulled "one" into the highlight,
    // tinting a word the agent never touched.
    expect(highlighted("line one", "line one\nline two")).toBe("\nline two");
  });

  it("does not double-count a shared prefix as a shared suffix", () => {
    // The bug this guards: counting the prefix again from the right yields
    // end < start and a highlight that renders inside out.
    const range = changedRange("aa", "aaa")!;
    expect(range.end).toBeGreaterThanOrEqual(range.start);
    // The raw range is the third "a"; word-widening covers the whole token,
    // since there is no boundary inside it to stop at.
    expect(highlighted("aa", "aaa")).toBe("aaa");
  });

  it("handles insertion into an empty note", () => {
    expect(highlighted("", "first words")).toBe("first words");
  });

  it("handles deleting everything", () => {
    const range = changedRange("all of it", "")!;
    expect(range).toEqual({ start: 0, end: 0 });
    expect(isPureDeletion(range)).toBe(true);
  });

  it("reports an insertion, not a deletion, when text is replaced by more text", () => {
    expect(isPureDeletion(changedRange("short", "much longer text")!)).toBe(false);
  });

  it("survives repeated content, where prefix and suffix scanning can overlap", () => {
    expect(highlighted("ababab", "abab")).toEqual(expect.any(String));
    expect(changedRange("ababab", "abab")).toEqual({ start: 4, end: 4 });
  });
});

describe("splitAroundRange", () => {
  /**
   * The invariant that matters: the three blocks, rejoined with the newlines the
   * split removed, must reproduce the note exactly. Anything else means the
   * highlighted view shows different text from the editor.
   */
  function rejoin(text: string, range: { start: number; end: number }): string {
    const { head, mid, tail } = splitAroundRange(text, range);
    return [head, mid, tail].filter((part, index) => part !== "" || index === 1).join("\n");
  }

  it("isolates the changed line, and the change's offset within it", () => {
    const body = "first\nsecond changed\nthird";
    const split = splitAroundRange(body, { start: body.indexOf("changed"), end: body.indexOf("changed") + 7 });
    expect(split.head).toBe("first");
    expect(split.mid).toBe("second changed");
    expect(split.tail).toBe("third");
    expect(split.mid.slice(split.midRange.start, split.midRange.end)).toBe("changed");
  });

  it("leaves no head when the change is on the first line", () => {
    const split = splitAroundRange("alpha\nbeta", { start: 0, end: 5 });
    expect(split.head).toBe("");
    expect(split.mid).toBe("alpha");
    expect(split.tail).toBe("beta");
  });

  it("leaves no tail when the change is on the last line", () => {
    const split = splitAroundRange("alpha\nbeta", { start: 6, end: 10 });
    expect(split.head).toBe("alpha");
    expect(split.mid).toBe("beta");
    expect(split.tail).toBe("");
  });

  it("keeps a change spanning several lines together in the middle block", () => {
    const body = "keep\nnew one\nnew two\nkeep too";
    const split = splitAroundRange(body, { start: 5, end: 20 });
    expect(split.mid).toBe("new one\nnew two");
    expect(split.head).toBe("keep");
    expect(split.tail).toBe("keep too");
  });

  it("round-trips the note for a single-line body", () => {
    expect(rejoin("just one line", { start: 5, end: 8 })).toBe("just one line");
  });

  it("round-trips the note for a multi-line body", () => {
    const body = "one\ntwo\nthree\nfour";
    expect(rejoin(body, { start: 4, end: 7 })).toBe(body);
  });

  it("round-trips a note that preserves interior blank lines", () => {
    const body = "# Title\n\nbody text\n\nmore";
    expect(rejoin(body, { start: 9, end: 18 })).toBe(body);
  });

  it("places a pure deletion as a zero-width point on its line", () => {
    const split = splitAroundRange("before\nafter trim\nlast", { start: 12, end: 12 });
    expect(split.mid).toBe("after trim");
    expect(split.midRange).toEqual({ start: 5, end: 5 });
  });
});
