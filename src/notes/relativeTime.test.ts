import { formatRelativeTime } from "./relativeTime";

const NOW = 1_700_000_000_000;

describe("formatRelativeTime", () => {
  it("shows 'Just now' for under a minute", () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe("Just now");
  });

  it("shows minutes for under an hour", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
  });

  it("shows hours for under a day", () => {
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe("3h ago");
  });

  it("shows days for under a week", () => {
    expect(formatRelativeTime(NOW - 2 * 24 * 60 * 60_000, NOW)).toBe("2d ago");
  });

  it("falls back to a date string past a week", () => {
    const eightDaysAgo = NOW - 8 * 24 * 60 * 60_000;
    expect(formatRelativeTime(eightDaysAgo, NOW)).toBe(new Date(eightDaysAgo).toLocaleDateString());
  });
});
