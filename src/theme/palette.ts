export type Palette = {
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentText: string;
  danger: string;
  /** Tinted background behind a danger message, so a save failure reads as an alert rather than body text. */
  dangerSurface: string;
  /**
   * Tint behind text the agent just changed (PRD §7.5). A background, not a text
   * colour: `accent` marks things you can tap, and recolouring note text with it
   * would read as a link.
   */
  accentSurface: string;
  success: string;
};

// Brand accent is orange throughout; only the surrounding neutrals shift
// between light/dark.
export const lightPalette: Palette = {
  background: "#FFFFFF",
  surface: "#F9FAFB",
  border: "#E5E7EB",
  text: "#111827",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  accent: "#F97316",
  accentText: "#FFFFFF",
  danger: "#DC2626",
  dangerSurface: "#FEF2F2",
  accentSurface: "#FFE8CC",
  success: "#16A34A",
};

export const darkPalette: Palette = {
  background: "#121212",
  surface: "#1E1E1E",
  border: "#2E2E2E",
  text: "#F3F4F6",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",
  accent: "#FB923C",
  accentText: "#111827",
  danger: "#F87171",
  dangerSurface: "#3B1D1D",
  accentSurface: "#4A2E12",
  success: "#4ADE80",
};
