/**
 * Where two versions of a note differ, as a range in the *new* text.
 *
 * Deliberately not a diff library. Trimming the common prefix and suffix finds
 * the changed region in one pass with no dependency, and per tool call that is
 * exactly right for a `rewrite_note` or a single `patch_note` edit. A multi-edit
 * patch collapses to one span covering all of its edits plus the untouched text
 * between them — accepted for now, since edits within a single patch are
 * usually adjacent. Reach for `fast-diff` (PRD §7.5) only if that proves sloppy
 * in practice.
 */
export type ChangedRange = {
  start: number;
  /** Exclusive. Equal to `start` for a pure deletion: nothing was inserted at this point. */
  end: number;
};

const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

/**
 * Grows a range out to whole words.
 *
 * Character-level trimming lands mid-word whenever the edit shares letters with
 * what it replaced: "one three" -> "one two three" shares the "t", so the raw
 * range is `wo t` — accurate, and unreadable as a highlight. Widening to word
 * boundaries can include a neighbouring word that didn't change, which is much
 * the lesser evil.
 */
function snapToWords(text: string, range: ChangedRange): ChangedRange {
  let { start, end } = range;
  // Only when the boundary is *inside* a word. A change that already begins or
  // ends at whitespace is left alone, or an inserted line would swallow the line
  // above it.
  while (start > 0 && !isSpace(text[start]) && !isSpace(text[start - 1])) start--;
  while (end < text.length && !isSpace(text[end - 1]) && !isSpace(text[end])) end++;
  return { start, end };
}

export function changedRange(before: string, after: string): ChangedRange | null {
  if (before === after) return null;

  const maxPrefix = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++;

  // Bounded so a shared prefix is never counted again as a shared suffix, which
  // would produce an inverted range for something like "aa" -> "aaa".
  const maxSuffix = Math.min(before.length - prefix, after.length - prefix);
  let suffix = 0;
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;

  const raw = { start: prefix, end: after.length - suffix };
  // A deletion is a point, not a span. Widening it would tint surrounding text
  // that is still exactly as the user wrote it.
  return isPureDeletion(raw) ? raw : snapToWords(after, raw);
}

/** True when text was removed and nothing put in its place, so there is nothing to tint. */
export function isPureDeletion(range: ChangedRange): boolean {
  return range.end === range.start;
}

export type RangeSplit = {
  /** Whole lines before the change. Empty when the change is on the first line. */
  head: string;
  /** The line(s) the change sits on, rendered as its own block so it can be measured. */
  mid: string;
  /** Whole lines after the change. Empty when the change is on the last line. */
  tail: string;
  /** The change's position within `mid`. */
  midRange: ChangedRange;
};

/**
 * Splits a note into three blocks at line boundaries, with the change isolated
 * in the middle one.
 *
 * This exists to make scrolling-to-the-change exact rather than estimated. A
 * nested `<Text>` can't be measured reliably, and guessing a y offset from line
 * counts breaks the moment a line wraps. Rendering the change's own line as a
 * sibling block means React Native reports its `y` in `onLayout` directly.
 *
 * Splitting on newlines is what keeps this invisible: each block is whole lines,
 * so stacking them looks identical to rendering the note in one piece.
 */
export function splitAroundRange(text: string, range: ChangedRange): RangeSplit {
  const lineStart = text.lastIndexOf("\n", range.start - 1) + 1;
  const nextNewline = text.indexOf("\n", range.end);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const rawHead = text.slice(0, lineStart);
  const rawTail = text.slice(lineEnd);

  return {
    // The separating newlines are dropped: each block already starts on its own
    // line, so keeping them would insert a blank line at every seam.
    head: rawHead.endsWith("\n") ? rawHead.slice(0, -1) : rawHead,
    mid: text.slice(lineStart, lineEnd),
    tail: rawTail.startsWith("\n") ? rawTail.slice(1) : rawTail,
    midRange: { start: range.start - lineStart, end: range.end - lineStart },
  };
}
