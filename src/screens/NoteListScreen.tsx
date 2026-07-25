import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createNote, deleteNote, listNotes, NoteSummary, purgeExpiredTrash, restoreNote } from "../notes/noteRepository";
import { formatRelativeTime } from "../notes/relativeTime";
import { Icon } from "../theme/icons";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

const UNDO_TIMEOUT_MS = 5000;
const FAB_SIZE = 62;
/** Gap between the floating layer and the bottom safe area. */
const FLOAT_INSET = 20;

type Props = {
  onOpenNote: (id: string) => void;
  onOpenSettings: () => void;
  /**
   * Changes whenever a pushed screen is dismissed. This screen is never
   * unmounted (see App.tsx), so it can't rely on mount to re-read the notes
   * directory — it re-reads when this token changes instead.
   */
  refreshToken: number;
};

export function NoteListScreen({ onOpenNote, onOpenSettings, refreshToken }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [lastDeleted, setLastDeleted] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setNotes(listNotes()), []);

  useEffect(() => {
    purgeExpiredTrash();
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshToken]);

  const handleCreate = useCallback(() => {
    const id = createNote();
    refresh();
    onOpenNote(id);
  }, [refresh, onOpenNote]);

  const handleDelete = useCallback(
    (note: NoteSummary) => {
      deleteNote(note.id);
      refresh();
      setLastDeleted({ id: note.id, title: note.title });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setLastDeleted(null), UNDO_TIMEOUT_MS);
    },
    [refresh],
  );

  const handleUndo = useCallback(() => {
    if (!lastDeleted) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    restoreNote(lastDeleted.id);
    setLastDeleted(null);
    refresh();
  }, [lastDeleted, refresh]);

  const floatBottom = insets.bottom + FLOAT_INSET;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notes</Text>
        <Pressable onPress={onOpenSettings} hitSlop={12}>
          <Icon name="settings" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      {notes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No notes yet</Text>
          <Text style={styles.emptyBody}>Notes are saved as plain markdown files on this device.</Text>
        </View>
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(note) => note.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          // Without this the last row sits under the FAB and can't be tapped.
          contentContainerStyle={{ paddingBottom: floatBottom + FAB_SIZE + 16 }}
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={(_progress, drag) => (
                <Animated.View style={{ transform: [{ translateX: drag.interpolate({ inputRange: [-100, 0], outputRange: [0, 100] }) }] }}>
                  <Pressable style={styles.deleteAction} onPress={() => handleDelete(item)}>
                    <Icon name="delete" size={20} color="#fff" />
                    <Text style={styles.deleteActionText}>Delete</Text>
                  </Pressable>
                </Animated.View>
              )}
            >
              <Pressable style={styles.row} onPress={() => onOpenNote(item.id)}>
                <View style={styles.rowTextContainer}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {formatRelativeTime(item.modifiedAt)}
                    {item.preview ? `  ·  ${item.preview}` : ""}
                  </Text>
                </View>
              </Pressable>
            </Swipeable>
          )}
        />
      )}

      <Pressable style={[styles.fab, { bottom: floatBottom }]} onPress={handleCreate}>
        <Icon name="add" size={28} color={colors.accentText} />
      </Pressable>

      {lastDeleted && (
        // Sits above the FAB rather than across it — both used to share
        // `bottom: 24`, which put "Undo" underneath the button.
        <View style={[styles.undoBar, { bottom: floatBottom + FAB_SIZE + 12 }]}>
          <Text style={styles.undoText} numberOfLines={1}>
            Deleted "{lastDeleted.title}"
          </Text>
          <Pressable onPress={handleUndo} hitSlop={8}>
            <Text style={styles.undoButton}>Undo</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: colors.text },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
    emptyTitle: { fontSize: 18, fontWeight: "600", marginBottom: 8, color: colors.text },
    emptyBody: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
    row: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: colors.background,
    },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 16 },
    rowTextContainer: { gap: 4 },
    rowTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
    rowMeta: { fontSize: 13, color: colors.textMuted },
    deleteAction: {
      backgroundColor: colors.danger,
      justifyContent: "center",
      alignItems: "center",
      gap: 2,
      width: 100,
      height: "100%",
    },
    deleteActionText: { color: "#fff", fontWeight: "600", fontSize: 12 },
    fab: {
      position: "absolute",
      right: FLOAT_INSET,
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
    undoBar: {
      position: "absolute",
      left: 16,
      right: 16,
      backgroundColor: colors.text,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    undoText: { color: colors.background, flex: 1, marginRight: 12 },
    undoButton: { color: colors.accent, fontWeight: "700" },
  });
