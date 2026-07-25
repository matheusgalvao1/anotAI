import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { createNote, deleteNote, listNotes, NoteSummary, purgeExpiredTrash, restoreNote } from "../notes/noteRepository";
import { formatRelativeTime } from "../notes/relativeTime";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

const UNDO_TIMEOUT_MS = 5000;

type Props = { onOpenNote: (id: string) => void; onOpenSettings: () => void };

export function NoteListScreen({ onOpenNote, onOpenSettings }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [lastDeleted, setLastDeleted] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setNotes(listNotes()), []);

  useEffect(() => {
    purgeExpiredTrash();
    refresh();
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [refresh]);

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

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notes</Text>
        <Pressable onPress={onOpenSettings} hitSlop={12}>
          <Ionicons name="settings-outline" size={28} color={colors.textSecondary} />
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
          renderItem={({ item }) => (
            <Swipeable
              renderRightActions={(_progress, drag) => (
                <Animated.View style={{ transform: [{ translateX: drag.interpolate({ inputRange: [-100, 0], outputRange: [0, 100] }) }] }}>
                  <Pressable style={styles.deleteAction} onPress={() => handleDelete(item)}>
                    <Ionicons name="trash-outline" size={22} color="#fff" />
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

      <Pressable style={styles.fab} onPress={handleCreate}>
        <Ionicons name="add" size={32} color={colors.accentText} />
      </Pressable>

      {lastDeleted && (
        <View style={styles.undoBar}>
          <Text style={styles.undoText} numberOfLines={1}>
            Deleted "{lastDeleted.title}"
          </Text>
          <Pressable onPress={handleUndo}>
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
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
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
      right: 20,
      bottom: 24,
      width: 62,
      height: 62,
      borderRadius: 31,
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
      bottom: 24,
      backgroundColor: colors.text,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    undoText: { color: colors.background, flex: 1, marginRight: 12 },
    undoButton: { color: colors.accent, fontWeight: "700" },
  });
