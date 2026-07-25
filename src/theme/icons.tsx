import Feather from "@expo/vector-icons/Feather";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

/**
 * Every icon in the app, named for what it *means* rather than which glyph it
 * happens to be. Screens import `Icon` and ask for `"undo"`, never for
 * `"corner-up-left"` — so restyling the whole app's iconography is a change to
 * the two maps below and nothing else.
 *
 * Feather is the base set: uniform 2px strokes, 24px grid, noticeably lighter
 * than Ionicons' outline variants. Feather has no sparkle glyph, so the one AI
 * affordance borrows Material Community's `creation`.
 */
export type IconName =
  | "about"
  | "add"
  | "ai"
  | "appearance"
  | "back"
  | "clipboard"
  | "close"
  | "collapse"
  | "conceal"
  | "dark"
  | "delete"
  | "dismissKeyboard"
  | "edit"
  | "expand"
  | "key"
  | "light"
  | "model"
  | "preview"
  | "redo"
  | "reveal"
  | "save"
  | "send"
  | "settings"
  | "stop"
  | "system"
  | "undo"
  | "validate"
  | "warning";

const FEATHER = {
  about: "info",
  add: "plus",
  appearance: "droplet",
  back: "chevron-left",
  clipboard: "clipboard",
  close: "x",
  collapse: "chevron-up",
  conceal: "eye-off",
  dark: "moon",
  delete: "trash-2",
  // A checkmark, not a chevron or a keyboard glyph: it confirms "done editing"
  // rather than describing the keyboard going away.
  dismissKeyboard: "check",
  edit: "edit-3",
  expand: "chevron-down",
  key: "key",
  light: "sun",
  model: "cpu",
  preview: "eye",
  redo: "corner-up-right",
  reveal: "eye",
  save: "check",
  send: "arrow-up",
  settings: "settings",
  system: "smartphone",
  undo: "corner-up-left",
  validate: "zap",
  warning: "alert-triangle",
} as const satisfies Partial<Record<IconName, keyof typeof Feather.glyphMap>>;

const MATERIAL = {
  ai: "creation",
  // A filled square reads as "stop generating" the way Feather's outlined
  // `square` doesn't.
  stop: "stop",
} as const satisfies Partial<Record<IconName, keyof typeof MaterialCommunityIcons.glyphMap>>;

type Props = { name: IconName; size?: number; color: string };

export function Icon({ name, size = 22, color }: Props) {
  if (name in MATERIAL) {
    return <MaterialCommunityIcons name={MATERIAL[name as keyof typeof MATERIAL]} size={size} color={color} />;
  }
  return <Feather name={FEATHER[name as keyof typeof FEATHER]} size={size} color={color} />;
}
