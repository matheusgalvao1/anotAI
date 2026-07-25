import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../theme/icons";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

export type PickerSection<T extends string> = {
  /** Omitted for a flat list with no grouping. */
  label?: string;
  options: { value: T; label: string; detail?: string }[];
};

type Props<T extends string> = {
  visible: boolean;
  title: string;
  sections: PickerSection<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  onClose: () => void;
  /** Shown in place of the list when there's nothing to choose from. */
  emptyMessage?: string;
};

/**
 * A grouped list in a sheet, used wherever Settings needs a dropdown.
 *
 * Deliberately not `@react-native-picker/picker`: that's a native module, so it
 * would mean a dev-client rebuild for every contributor, and its iOS wheel can't
 * show grouped sections anyway. `Modal` is in React Native core.
 */
export function PickerModal<T extends string>({
  visible,
  title,
  sections,
  selected,
  onSelect,
  onClose,
  emptyMessage,
}: Props<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isEmpty = sections.every((section) => section.options.length === 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Tapping the dimmed area closes, matching the prompt field's behaviour. */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Icon name="close" size={22} color={colors.textSecondary} />
          </Pressable>
        </View>

        {isEmpty ? (
          <Text style={styles.empty}>{emptyMessage ?? "Nothing to choose from."}</Text>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {sections.map((section, index) => (
              <View key={section.label ?? `section-${index}`}>
                {section.label && <Text style={styles.sectionLabel}>{section.label}</Text>}
                {section.options.map((option) => {
                  const active = option.value === selected;
                  return (
                    <Pressable
                      key={option.value}
                      style={styles.row}
                      onPress={() => {
                        onSelect(option.value);
                        onClose();
                      }}
                    >
                      <View style={styles.rowText}>
                        <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>
                          {option.label}
                        </Text>
                        {option.detail && (
                          <Text style={styles.rowDetail} numberOfLines={1}>
                            {option.detail}
                          </Text>
                        )}
                      </View>
                      {active && <Icon name="save" size={18} color={colors.accent} />}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
    sheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: "75%",
      backgroundColor: colors.background,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingBottom: 28,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 17, fontWeight: "700", color: colors.text },
    list: { paddingBottom: 12 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 13,
    },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontSize: 15, color: colors.text },
    rowLabelActive: { color: colors.accent, fontWeight: "600" },
    rowDetail: { fontSize: 12, color: colors.textMuted },
    empty: { padding: 24, fontSize: 14, color: colors.textSecondary, textAlign: "center" },
  });
