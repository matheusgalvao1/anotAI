import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconName } from "../theme/icons";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import { TurnStatus } from "./useAgentTurn";
import { useKeyboardHeight } from "./useKeyboardHeight";

const FAB_SIZE = 62;
const SMALL_SIZE = 44;
const FLOAT_INSET = 20;
/** Explicit, because the 4-line ceiling below is computed from it. */
const STATUS_LINE_HEIGHT = 18;
const STATUS_MAX_LINES = 4;
const STATUS_MAX_HEIGHT = STATUS_LINE_HEIGHT * STATUS_MAX_LINES;

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
  disabledReason: string | null;
  status: TurnStatus;
  /** Closing the field ends the exchange, so the model's last reply goes with it. */
  onClearStatus: () => void;
};

/**
 * The whole bottom floating layer on the editor screen (PRD §7.3/§7.4/§7.6):
 * status line, prompt field, undo/redo, and the main action button.
 *
 * Three rules drive the layout:
 *
 * - The undo/redo column and the main button never move. Opening the composer
 *   grows a card to their left rather than replacing them, so nothing jumps and
 *   undo stays reachable mid-prompt.
 * - The status line sits in the same column as the prompt field, directly above
 *   it — not above the whole cluster — and carries no background of its own.
 * - The main button is only ever four things: AI (closed), send (open, inert
 *   with no text, live with text), or stop (a turn is running). It is never a
 *   close button; closing is an outside tap.
 */
export function AgentFab({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  busy,
  onCancel,
  onSubmit,
  disabledReason,
  status,
  onClearStatus,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // While the keyboard is up it covers the home indicator, so the safe-area
  // inset would double-count. Sitting on the keyboard's top edge is what keeps
  // the prompt field and its status line visible as you type.
  const layerBottom = (keyboardHeight > 0 ? keyboardHeight : insets.bottom) + FLOAT_INSET;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  const trimmed = text.trim();
  const showComposer = open || busy;
  /** Open with an empty field: the send button is visible but inert. */
  const sendInert = open && !busy && !trimmed;

  const handleMainPress = () => {
    if (busy) {
      onCancel();
      return;
    }
    if (!open) {
      if (disabledReason) {
        Alert.alert("AI editing unavailable", disabledReason);
        return;
      }
      setOpen(true);
      return;
    }
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
    // Deliberately stays open, and keeps the keyboard, so a follow-up prompt
    // needs no extra taps. Only an outside tap closes it.
    inputRef.current?.focus();
  };

  const mainIcon: IconName = busy ? "stop" : open ? "send" : "ai";

  return (
    <>
      {/* The only way to close the composer. Mounted just while it's open, so
          it never intercepts editing otherwise. */}
      {open && !busy && (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close the AI prompt"
          onPress={() => {
            setOpen(false);
            onClearStatus();
            inputRef.current?.blur();
          }}
        />
      )}

      <View style={[styles.layer, { bottom: layerBottom }]} pointerEvents="box-none">
        <View style={styles.promptColumn} pointerEvents="box-none">
          {status && <StatusLine key={status.text} status={status} />}

          {showComposer && (
            <View style={styles.composerCard}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={busy ? "Working…" : "Ask AI to edit this note…"}
                placeholderTextColor={colors.textMuted}
                editable={!busy}
                autoFocus
                // Single line on purpose: a growing field shifts the whole
                // cluster and breaks its alignment with the button beside it.
                // Long prompts scroll horizontally instead.
                multiline={false}
                returnKeyType="send"
                submitBehavior="submit"
                onSubmitEditing={handleMainPress}
                style={styles.composerInput}
              />
            </View>
          )}
        </View>

        <View style={styles.buttonColumn}>
          <Pressable style={styles.fabSmall} disabled={!canRedo} onPress={onRedo} hitSlop={6}>
            <Icon name="redo" size={19} color={canRedo ? colors.text : colors.textMuted} />
          </Pressable>
          <Pressable style={styles.fabSmall} disabled={!canUndo} onPress={onUndo} hitSlop={6}>
            <Icon name="undo" size={19} color={canUndo ? colors.text : colors.textMuted} />
          </Pressable>
          <Pressable style={[styles.fabMain, sendInert && styles.fabMainInert]} disabled={sendInert} onPress={handleMainPress}>
            <Icon name={mainIcon} size={busy ? 24 : 26} color={sendInert ? colors.textMuted : colors.accentText} />
          </Pressable>
        </View>
      </View>
    </>
  );
}

/**
 * The model's reply. Capped at four lines and scrollable past that, rather than
 * ellipsised — a truncated explanation of what the agent *couldn't* do is worse
 * than no explanation.
 *
 * Module scope, and keyed on the message by its caller, so each new status
 * measures itself from scratch instead of inheriting the last one's overflow.
 */
function StatusLine({ status }: { status: NonNullable<TurnStatus> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [overflowing, setOverflowing] = useState(false);

  return (
    <View style={styles.statusRow} pointerEvents="box-none">
      {status.kind === "working" && <ActivityIndicator size="small" color={colors.textSecondary} />}
      <ScrollView
        style={styles.statusScroll}
        contentContainerStyle={styles.statusScrollContent}
        // A short reply stays tap-through, so tapping it still closes the
        // prompt field; only a reply that actually overflows takes touches.
        pointerEvents={overflowing ? "auto" : "none"}
        scrollEnabled={overflowing}
        showsVerticalScrollIndicator={overflowing}
        onContentSizeChange={(_width, height) => setOverflowing(height > STATUS_MAX_HEIGHT + 1)}
      >
        <Text style={[styles.statusText, styles[`status_${status.kind}`]]}>{status.text}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    layer: {
      position: "absolute",
      left: 16,
      right: FLOAT_INSET,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
    },
    /** Status and prompt field share this column so the status sits directly above the field. */
    promptColumn: { flex: 1, alignItems: "stretch", gap: 6 },
    buttonColumn: { alignItems: "center", gap: 12 },
    fabSmall: {
      width: SMALL_SIZE,
      height: SMALL_SIZE,
      borderRadius: SMALL_SIZE / 2,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      // Without a shadow these vanish against note text: `surface` is only a
      // shade off `background` in the light palette.
      elevation: 2,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    fabMain: {
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 3 },
    },
    fabMainInert: {
      backgroundColor: colors.border,
      elevation: 0,
      shadowOpacity: 0,
    },
    composerCard: {
      // Exactly the button's height, so bottom-aligning the row also centres
      // the two on each other — no offset to tune, and none to drift.
      height: FAB_SIZE,
      borderRadius: FAB_SIZE / 2,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 20,
      justifyContent: "center",
      elevation: 4,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    composerInput: {
      fontSize: 15,
      color: colors.text,
      padding: 0,
    },
    // No surface of its own: it reads as a caption on the prompt field, not a
    // separate panel.
    statusRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 6 },
    statusScroll: { flex: 1, maxHeight: STATUS_MAX_HEIGHT },
    statusScrollContent: { paddingRight: 2 },
    statusText: { fontSize: 13, lineHeight: STATUS_LINE_HEIGHT, fontWeight: "500" },
    status_working: { color: colors.textSecondary },
    status_success: { color: colors.success },
    status_none: { color: colors.textMuted },
    status_error: { color: colors.danger },
    status_cancelled: { color: colors.textMuted },
  });
