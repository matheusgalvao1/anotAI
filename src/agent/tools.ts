import { AGENT_CONFIG } from "./config";
import { NoteStore } from "./noteStore";
import { ToolSchema } from "./types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const READ_NOTE_SCHEMA: ToolSchema = {
  name: "read_note",
  description:
    "Read the current note content, optionally a line range. Returns raw text with no line-number prefixes.",
  parameters: {
    type: "object",
    properties: {
      offset: { type: "number", description: "0-based starting line, default 0" },
      limit: { type: "number", description: "number of lines to return, default 500" },
    },
  },
};

export const REWRITE_NOTE_SCHEMA: ToolSchema = {
  name: "rewrite_note",
  description:
    "Replace the entire note body. Use for structural changes, format changes, or when more than roughly half the note changes.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "the full new markdown body" },
    },
    required: ["content"],
  },
};

export const PATCH_NOTE_SCHEMA: ToolSchema = {
  name: "patch_note",
  description:
    "Apply one or more targeted find/replace edits, in order, atomically. Use for localized changes. old_string must match the note exactly, or be unique after whitespace normalization.",
  parameters: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "edits to apply in order",
        items: {
          type: "object",
          properties: {
            old_string: { type: "string" },
            new_string: { type: "string" },
            replace_all: {
              type: "boolean",
              description: "replace every occurrence instead of requiring a unique match, default false",
            },
          },
          required: ["old_string", "new_string"],
        },
      },
    },
    required: ["edits"],
  },
};

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

/**
 * Tool arguments arrive as whatever the model streamed, parsed leniently — a
 * truncated or malformed tool call yields `{}`, not the declared shape. So
 * every executor validates before touching the note. A bad argument must come
 * back as a tool error the model can recover from on the next iteration, never
 * as a thrown exception (which would kill the whole turn) and never as a write
 * of `undefined` into the user's note.
 */
export type ToolArgError = { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerces an optional number argument, tolerating the numeric strings some models emit. */
function optionalNumber(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

// ---------------------------------------------------------------------------
// read_note
// ---------------------------------------------------------------------------

export type ReadNoteArgs = { offset?: number; limit?: number };
export type ReadNoteResult = { content: string; total_lines: number; has_more: boolean };

export function executeReadNote(store: NoteStore, args: unknown): ReadNoteResult | ToolArgError {
  const raw = isPlainObject(args) ? args : {};

  const offsetValue = optionalNumber(raw.offset, 0);
  if (offsetValue === null) return { ok: false, error: "offset must be a number." };
  const limitValue = optionalNumber(raw.limit, AGENT_CONFIG.READ_NOTE_DEFAULT_LIMIT_LINES);
  if (limitValue === null) return { ok: false, error: "limit must be a number." };

  const lines = store.read().split("\n");
  const offset = Math.max(0, Math.trunc(offsetValue));
  const limit = Math.max(0, Math.trunc(limitValue));
  const slice = lines.slice(offset, offset + limit);
  return {
    content: slice.join("\n"),
    total_lines: lines.length,
    has_more: offset + limit < lines.length,
  };
}

// ---------------------------------------------------------------------------
// rewrite_note
// ---------------------------------------------------------------------------

export type RewriteNoteArgs = { content: string };
export type RewriteNoteResult = { ok: true; bytes: number };

export function executeRewriteNote(store: NoteStore, args: unknown): RewriteNoteResult | ToolArgError {
  const raw = isPlainObject(args) ? args : {};

  if (typeof raw.content !== "string") {
    return {
      ok: false,
      error: "rewrite_note requires a `content` string holding the full new note body. Nothing was written.",
    };
  }

  store.write(raw.content);
  return { ok: true, bytes: new TextEncoder().encode(raw.content).length };
}

// ---------------------------------------------------------------------------
// patch_note
// ---------------------------------------------------------------------------

export type PatchEdit = { old_string: string; new_string: string; replace_all?: boolean };
export type PatchNoteArgs = { edits: PatchEdit[] };
export type PatchNoteResult =
  | { ok: true; applied: number }
  /** `failed_index` is present only when a specific edit failed, not when the arguments themselves were malformed. */
  | { ok: false; error: string; failed_index?: number };

const RETRY_HINT = "Try read_note to see the current content, then use rewrite_note instead.";

/** Validates one entry of the `edits` array, rejecting anything that isn't a well-formed edit. */
function parseEdit(value: unknown, index: number): { ok: true; edit: PatchEdit } | ToolArgError {
  if (!isPlainObject(value)) {
    return { ok: false, error: `edits[${index}] must be an object with old_string and new_string.` };
  }
  if (typeof value.old_string !== "string") {
    return { ok: false, error: `edits[${index}].old_string must be a string.` };
  }
  if (typeof value.new_string !== "string") {
    return { ok: false, error: `edits[${index}].new_string must be a string.` };
  }
  if (value.replace_all !== undefined && typeof value.replace_all !== "boolean") {
    return { ok: false, error: `edits[${index}].replace_all must be a boolean when present.` };
  }
  return {
    ok: true,
    edit: { old_string: value.old_string, new_string: value.new_string, replace_all: value.replace_all },
  };
}

export function executePatchNote(store: NoteStore, args: unknown): PatchNoteResult {
  const raw = isPlainObject(args) ? args : {};

  if (!Array.isArray(raw.edits)) {
    return {
      ok: false,
      error: "patch_note requires an `edits` array of {old_string, new_string} objects. Nothing was written.",
    };
  }
  if (raw.edits.length === 0) {
    return { ok: false, error: "patch_note requires at least one edit. Nothing was written." };
  }

  const edits: PatchEdit[] = [];
  for (let i = 0; i < raw.edits.length; i++) {
    const parsed = parseEdit(raw.edits[i], i);
    if (!parsed.ok) return { ok: false, error: `${parsed.error} Nothing was written.` };
    edits.push(parsed.edit);
  }

  let content = store.read();

  for (let i = 0; i < edits.length; i++) {
    const result = applyEdit(content, edits[i]);
    if (!result.ok) {
      return { ok: false, error: `${result.error} ${RETRY_HINT}`, failed_index: i };
    }
    content = result.content;
  }

  store.write(content);
  return { ok: true, applied: edits.length };
}

type ApplyEditResult = { ok: true; content: string } | { ok: false; error: string };

function applyEdit(content: string, edit: PatchEdit): ApplyEditResult {
  const { old_string, new_string, replace_all = false } = edit;

  if (old_string.length === 0) {
    return { ok: false, error: "old_string must not be empty." };
  }

  const exactCount = countOccurrences(content, old_string);
  if (exactCount > 0) {
    if (exactCount > 1 && !replace_all) {
      return {
        ok: false,
        error: `old_string matches ${exactCount} locations in the note; add more surrounding context to make it unique, or set replace_all.`,
      };
    }
    return {
      ok: true,
      content: replace_all ? replaceAllOccurrences(content, old_string, new_string) : replaceFirstOccurrence(content, old_string, new_string),
    };
  }

  // Exact match failed — fall back to a whitespace-normalized match. This is
  // as far as v1 goes deliberately: anything looser (fuzzy/approximate) risks
  // guessing wrong, which is worse than surfacing an error to the model.
  const normalizedNeedle = normalizeWhitespace(old_string);
  const matches = findNormalizedMatches(content, normalizedNeedle);

  if (matches.length === 0) {
    return { ok: false, error: "old_string was not found in the note (even ignoring whitespace differences)." };
  }
  if (matches.length > 1 && !replace_all) {
    return {
      ok: false,
      error: `old_string matches ${matches.length} locations after ignoring whitespace differences; add more surrounding context, or set replace_all.`,
    };
  }

  const toReplace = replace_all ? matches : [matches[0]];
  let result = content;
  for (const m of [...toReplace].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, m.start) + new_string + result.slice(m.end);
  }
  return { ok: true, content: result };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count++;
    idx = found + needle.length;
  }
  return count;
}

function replaceFirstOccurrence(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

function replaceAllOccurrences(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}

function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

type Span = { start: number; end: number };

/**
 * Builds a whitespace-collapsed view of `content` alongside a map back to
 * original offsets, so a match found in the collapsed string can be applied
 * as a precise splice against the original text.
 */
function buildNormalizedIndex(content: string): { normalized: string; starts: number[]; ends: number[] } {
  let normalized = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    if (/\s/.test(content[i])) {
      const runStart = i;
      while (i < n && /\s/.test(content[i])) i++;
      normalized += " ";
      starts.push(runStart);
      ends.push(i);
    } else {
      normalized += content[i];
      starts.push(i);
      ends.push(i + 1);
      i++;
    }
  }

  return { normalized, starts, ends };
}

function findNormalizedMatches(content: string, normalizedNeedle: string): Span[] {
  if (normalizedNeedle.length === 0) return [];

  const { normalized, starts, ends } = buildNormalizedIndex(content);
  const matches: Span[] = [];
  let fromIndex = 0;

  while (true) {
    const idx = normalized.indexOf(normalizedNeedle, fromIndex);
    if (idx === -1) break;
    const matchEndIdx = idx + normalizedNeedle.length - 1;
    matches.push({ start: starts[idx], end: ends[matchEndIdx] });
    fromIndex = idx + 1;
  }

  return matches;
}
