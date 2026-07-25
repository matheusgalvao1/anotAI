const MAX_TITLE_LENGTH = 100;
const MAX_PREVIEW_LENGTH = 140;

export type TitleAndPreview = { title: string; preview: string };

/**
 * Title is never stored — it's derived from the first non-empty line on
 * every read (PRD §5). Preview is the next non-empty line after that, for
 * the note-list row.
 */
export function deriveTitleAndPreview(body: string): TitleAndPreview {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { title: "New Note", preview: "" };

  const titleSource = lines[0].replace(/^#+\s*/, "").trim();
  const title = titleSource.length > 0 ? titleSource.slice(0, MAX_TITLE_LENGTH) : "New Note";
  const preview = (lines[1] ?? "").slice(0, MAX_PREVIEW_LENGTH);

  return { title, preview };
}
