import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (prompt: string) => void;
  disabledReason: string | null;
};

/**
 * The whole bottom-right floating cluster on the editor screen (PRD §7.3/§7.6).
 * Closed: Redo/Undo stacked above the main FAB. Open: the FAB stays in the
 * same spot and becomes the send button, with a floating card growing to
 * its left for the prompt text.
 */
export function AgentFab({ canUndo, canRedo, onUndo, onRedo, busy, onCancel, onSubmit, disabledReason }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

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
    const trimmed = text.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setText("");
    }
    setOpen(false);
  };

  if (busy) {
    return (
      <View style={styles.anchorClosed}>
        <Pressable style={styles.fabMain} onPress={onCancel}>
          <ActivityIndicator color={colors.accentText} />
        </Pressable>
      </View>
    );
  }

  if (open) {
    return (
      <View style={styles.anchorOpen}>
        <View style={styles.composerCard}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Ask AI to edit this note…"
            placeholderTextColor={colors.textMuted}
            autoFocus
            multiline
            style={styles.composerInput}
          />
        </View>
        <Pressable style={styles.fabMain} onPress={handleMainPress}>
          <Ionicons name={text.trim() ? "arrow-up" : "close"} size={26} color={colors.accentText} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.anchorClosed}>
      <Pressable style={styles.fabSmall} disabled={!canRedo} onPress={onRedo}>
        <Ionicons name="arrow-redo" size={20} color={canRedo ? colors.text : colors.textMuted} />
      </Pressable>
      <Pressable style={styles.fabSmall} disabled={!canUndo} onPress={onUndo}>
        <Ionicons name="arrow-undo" size={20} color={canUndo ? colors.text : colors.textMuted} />
      </Pressable>
      <Pressable style={styles.fabMain} onPress={handleMainPress}>
        <Ionicons name="sparkles" size={26} color={colors.accentText} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    anchorClosed: {
      position: "absolute",
      right: 20,
      bottom: 24,
      alignItems: "center",
      gap: 12,
    },
    anchorOpen: {
      position: "absolute",
      left: 16,
      right: 20,
      bottom: 24,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
    },
    fabSmall: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    fabMain: {
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
    composerCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 4,
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
      maxHeight: 120,
      paddingVertical: 10,
    },
  });
