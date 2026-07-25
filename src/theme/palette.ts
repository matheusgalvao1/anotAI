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
  success: "#4ADE80",
};
