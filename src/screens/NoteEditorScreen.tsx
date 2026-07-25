import { useCallback, useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../theme/icons";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import { AgentFab } from "./AgentFab";
import { NoteHighlight } from "./NoteHighlight";
import { useAgentTurn } from "./useAgentTurn";
import { useKeyboardHeight } from "./useKeyboardHeight";
import { useNoteSession } from "./useNoteSession";

type Props = { noteId: string; onBack: () => void };

/**
 * Renders one note and wires the two things that act on it: the note session
 * (what's typed, what's saved, what can be undone) and the agent turn (what the
 * model is asked to do). Both are hooks so this file stays about presentation.
 */
export function NoteEditorScreen({ noteId, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const markdownStyles = useMemo(() => makeMarkdownStyles(colors), [colors]);

  const session = useNoteSession(noteId);
  const keyboardHeight = useKeyboardHeight();
  const [previewing, setPreviewing] = useState(false);
  // Only a brand-new note should raise the keyboard on open — otherwise it
  // covers half the note you came to read, plus the whole button cluster.
  const [autoFocus] = useState(() => session.body.length === 0);

  const turn = useAgentTurn({
    noteId,
    bodyRef: session.bodyRef,
    flush: session.flush,
    onBodyChanged: session.adoptAgentResult,
    onRevert: session.revertAgentResult,
    onStorageError: session.reportStorageError,
  });

  const handleBack = useCallback(() => {
    session.flush();
    onBack();
  }, [session, onBack]);

  const editingDisabled = turn.busy || session.loadFailed;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.toolbar}>
        <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
          <Icon name="back" size={24} color={colors.accent} />
          <Text style={styles.backText}>Notes</Text>
        </Pressable>
        <View style={styles.toolbarRight}>
          <Pressable onPress={() => setPreviewing((p) => !p)} hitSlop={12}>
            <Icon name={previewing ? "edit" : "preview"} size={22} color={colors.text} />
          </Pressable>
          {/* Only while the keyboard is up, as in Apple Notes. A multiline field
              has no Done key of its own, so without this there is no way to
              dismiss the keyboard at all. */}
          {keyboardHeight > 0 && (
            <Pressable onPress={() => Keyboard.dismiss()} hitSlop={12} accessibilityLabel="Dismiss the keyboard">
              <Icon name="dismissKeyboard" size={26} color={colors.accent} />
            </Pressable>
          )}
        </View>
      </View>

      {session.storageError && (
        <View style={styles.storageBanner}>
          <Icon name="warning" size={18} color={colors.danger} />
          <Text style={styles.storageBannerText}>{session.storageError}</Text>
          {!session.loadFailed && (
            <Pressable onPress={session.retrySave} hitSlop={8}>
              <Text style={styles.storageBannerAction}>Retry</Text>
            </Pressable>
          )}
          <Pressable onPress={session.dismissStorageError} hitSlop={8}>
            <Icon name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <View style={styles.content}>
        {/* The editing surface is inset by the keyboard so the text being typed
            is never under it. Separate from the floating cluster's own offset,
            which is absolutely positioned against `content` and so has to
            account for the keyboard itself. */}
        <View style={[styles.editorArea, { paddingBottom: keyboardHeight }]}>
        {turn.highlight ? (
          // Takes the editor's place while a change is tinted. The note is
          // read-only for those few seconds — which costs nothing mid-turn,
          // since the editor is already read-only then — and any tap hands
          // editing straight back.
          <NoteHighlight body={turn.highlight.body} range={turn.highlight.range} onDismiss={turn.dismissHighlight} />
        ) : previewing ? (
          // Scrollable: a plain View silently cut off any note taller than the
          // screen, with no way to reach the rest.
          <ScrollView style={styles.content} contentContainerStyle={styles.previewContainer}>
            <Markdown style={markdownStyles}>{session.body}</Markdown>
          </ScrollView>
        ) : (
          <TextInput
            autoFocus={autoFocus}
            multiline
            editable={!editingDisabled}
            value={session.body}
            onChangeText={session.edit}
            style={[styles.input, editingDisabled && styles.inputBusy]}
            placeholderTextColor={colors.textMuted}
            textAlignVertical="top"
            placeholder="Start writing…"
          />
        )}
        </View>

        {/* Owns the status line too, so nothing renders below the prompt field
            where the keyboard would cover it (PRD §7.4). */}
        <AgentFab
          canUndo={session.canUndo}
          canRedo={session.canRedo}
          onUndo={session.undo}
          onRedo={session.redo}
          busy={turn.busy}
          onCancel={turn.cancel}
          onSubmit={turn.submit}
          status={turn.status}
          onClearStatus={turn.clearStatus}
          disabledReason={session.loadFailed ? "This note could not be opened." : turn.disabledReason}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * react-native-markdown-display ships near-black defaults, which are invisible
 * on the dark palette's #121212 background. Every colour it can use has to come
 * from the theme.
 */
const makeMarkdownStyles = (colors: Palette) => ({
  body: { color: colors.text, fontSize: 16, lineHeight: 23 },
  heading1: { color: colors.text, fontSize: 26, fontWeight: "700" as const, marginTop: 8, marginBottom: 6 },
  heading2: { color: colors.text, fontSize: 21, fontWeight: "700" as const, marginTop: 8, marginBottom: 4 },
  heading3: { color: colors.text, fontSize: 18, fontWeight: "600" as const, marginTop: 6, marginBottom: 4 },
  hr: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  link: { color: colors.accent },
  blockquote: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.accent,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 6,
  },
  code_inline: { backgroundColor: colors.surface, color: colors.text, borderWidth: 0, fontSize: 14 },
  code_block: { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, borderRadius: 8 },
  fence: { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, borderRadius: 8 },
  table: { borderColor: colors.border },
  tr: { borderColor: colors.border },
  bullet_list_icon: { color: colors.textSecondary },
  ordered_list_icon: { color: colors.textSecondary },
});

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    toolbar: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: { flexDirection: "row", alignItems: "center" },
    toolbarRight: { flexDirection: "row", alignItems: "center", gap: 18 },
    backText: { color: colors.accent, fontSize: 16, fontWeight: "600", marginLeft: 2 },
    content: { flex: 1 },
    editorArea: { flex: 1 },
    input: { flex: 1, fontSize: 16, padding: 16, color: colors.text },
    inputBusy: { backgroundColor: colors.surface, color: colors.textMuted },
    previewContainer: { padding: 16, paddingBottom: 160 },
    storageBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.dangerSurface,
    },
    storageBannerText: { flex: 1, color: colors.danger, fontSize: 13, fontWeight: "500" },
    storageBannerAction: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  });
