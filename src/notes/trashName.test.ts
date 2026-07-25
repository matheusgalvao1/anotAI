import { isExpired, parseTrashedName, trashedName } from "./trashName";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("trashedName", () => {
  it("round-trips an id and deletion time", () => {
    const name = trashedName("01HQZX3K7Y8V9W0ABCDEFGHJKM", 1_700_000_000_000);
    expect(parseTrashedName(name)).toEqual({ id: "01HQZX3K7Y8V9W0ABCDEFGHJKM", deletedAt: 1_700_000_000_000 });
  });

  it("keeps the .md extension so the file stays a markdown file", () => {
    expect(trashedName("abc", 1)).toMatch(/\.md$/);
  });
});

describe("parseTrashedName", () => {
  it.each([
    ["a plain note filename", "01HQZX3K.md"],
    ["a non-numeric timestamp", "01HQZX3K.deleted-yesterday.md"],
    ["a missing timestamp", "01HQZX3K.deleted-.md"],
    ["an unrelated file", "notes.txt"],
    ["an empty name", ""],
  ])("returns null for %s", (_label, fileName) => {
    expect(parseTrashedName(fileName)).toBeNull();
  });

  it("tolerates an id containing dots", () => {
    expect(parseTrashedName(trashedName("my.note.v2", 42))).toEqual({ id: "my.note.v2", deletedAt: 42 });
  });
});

/**
 * The regression this guards: purging used a file's mtime, which `move` preserves.
 * A note whose last edit was older than the retention window was purged on the
 * next launch after being deleted, so the trash never actually held it.
 */
describe("isExpired", () => {
  const now = 1_700_000_000_000;

  it("keeps a note deleted just now, however old its last edit was", () => {
    expect(isExpired(now, now, RETENTION_MS)).toBe(false);
  });

  it("keeps a note one day short of the retention window", () => {
    expect(isExpired(now - (RETENTION_MS - DAY_MS), now, RETENTION_MS)).toBe(false);
  });

  it("purges a note one day past the retention window", () => {
    expect(isExpired(now - (RETENTION_MS + DAY_MS), now, RETENTION_MS)).toBe(true);
  });

  it("does not purge exactly at the boundary", () => {
    expect(isExpired(now - RETENTION_MS, now, RETENTION_MS)).toBe(false);
  });
});
