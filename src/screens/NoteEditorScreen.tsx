import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import { AgentFab } from "./AgentFab";
import { useAgentTurn } from "./useAgentTurn";
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

  const session = useNoteSession(noteId);
  const [previewing, setPreviewing] = useState(false);

  const turn = useAgentTurn({
    noteId,
    bodyRef: session.bodyRef,
    flush: session.flush,
    onBodyChanged: session.adoptAgentResult,
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
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
          <Text style={styles.backText}>Notes</Text>
        </Pressable>
        <Pressable onPress={() => setPreviewing((p) => !p)} hitSlop={12}>
          <Ionicons name={previewing ? "create-outline" : "eye-outline"} size={26} color={colors.text} />
        </Pressable>
      </View>

      {session.storageError && (
        <View style={styles.storageBanner}>
          <Ionicons name="warning-outline" size={20} color={colors.danger} />
          <Text style={styles.storageBannerText}>{session.storageError}</Text>
          {!session.loadFailed && (
            <Pressable onPress={session.retrySave} hitSlop={8}>
              <Text style={styles.storageBannerAction}>Retry</Text>
            </Pressable>
          )}
          <Pressable onPress={session.dismissStorageError} hitSlop={8}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {previewing ? (
          <View style={styles.previewContainer}>
            <Markdown>{session.body}</Markdown>
          </View>
        ) : (
          <TextInput
            autoFocus
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

        <AgentFab
          canUndo={session.canUndo}
          canRedo={session.canRedo}
          onUndo={session.undo}
          onRedo={session.redo}
          busy={turn.busy}
          onCancel={turn.cancel}
          onSubmit={turn.submit}
          disabledReason={session.loadFailed ? "This note could not be opened." : turn.disabledReason}
        />
      </KeyboardAvoidingView>

      {turn.status && (
        <Text style={[styles.statusLine, styles[`status_${turn.status.kind}`]]} numberOfLines={2}>
          {turn.status.text}
        </Text>
      )}
    </SafeAreaView>
  );
}

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
    backText: { color: colors.accent, fontSize: 16, fontWeight: "600", marginLeft: 2 },
    content: { flex: 1 },
    input: { flex: 1, fontSize: 16, padding: 16, color: colors.text },
    inputBusy: { backgroundColor: colors.surface, color: colors.textMuted },
    previewContainer: { flex: 1, padding: 16 },
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
    statusLine: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 6 },
    status_working: { color: colors.textSecondary },
    status_success: { color: colors.success },
    status_none: { color: colors.textMuted },
    status_error: { color: colors.danger },
    status_cancelled: { color: colors.textMuted },
  });
