import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../theme/icons";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";

export type DropdownSection<T extends string> = {
  /** Omitted for a flat list with no grouping. */
  label?: string;
  options: { value: T; label: string; detail?: string }[];
};

/** Roughly six rows before the list scrolls on its own. */
const MAX_LIST_HEIGHT = 290;

type Props<T extends string> = {
  /** Shown in the closed row when nothing is selected. */
  placeholder: string;
  selected: T | null;
  /** Display text for the selection, when it differs from the raw value. */
  selectedLabel?: string | null;
  sections: DropdownSection<T>[];
  onSelect: (value: T) => void;
  disabled?: boolean;
  loading?: boolean;
  emptyMessage?: string;
};

/**
 * A select that expands in place, rather than covering the screen.
 *
 * Replaced a bottom-sheet modal, which was too heavy an interaction for picking
 * one value. Still no native dependency: `@react-native-picker/picker` would
 * force a dev-client rebuild on every contributor and its iOS wheel can't render
 * grouped sections at all.
 *
 * The expanded list caps its own height and scrolls internally, because a
 * provider catalogue runs to hundreds of models and pushing that much content
 * into the page would bury everything below it.
 */
export function Dropdown<T extends string>({
  placeholder,
  selected,
  selectedLabel,
  sections,
  onSelect,
  disabled,
  loading,
  emptyMessage,
}: Props<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const isEmpty = sections.every((section) => section.options.length === 0);
  const display = selectedLabel ?? selected;

  return (
    <View style={styles.wrapper}>
      <Pressable
        style={[styles.trigger, open && styles.triggerOpen, disabled && styles.triggerDisabled]}
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
      >
        <Text style={display ? styles.value : styles.placeholder} numberOfLines={1}>
          {display ?? placeholder}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          // Points down when closed, up when open — the affordance that says
          // tapping again collapses it.
          <Icon name={open ? "collapse" : "expand"} size={18} color={colors.textSecondary} />
        )}
      </Pressable>

      {open && (
        <View style={styles.panel}>
          {isEmpty ? (
            <Text style={styles.empty}>{emptyMessage ?? "Nothing to choose from."}</Text>
          ) : (
            <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
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
                          setOpen(false);
                        }}
                      >
                        <View style={styles.rowText}>
                          <Text style={[styles.rowLabel, active && styles.rowLabelActive]} numberOfLines={1}>
                            {option.label}
                          </Text>
                          {option.detail && option.detail !== option.label && (
                            <Text style={styles.rowDetail} numberOfLines={1}>
                              {option.detail}
                            </Text>
                          )}
                        </View>
                        {active && <Icon name="save" size={16} color={colors.accent} />}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrapper: { gap: 6 },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      backgroundColor: colors.background,
    },
    triggerOpen: { borderColor: colors.accent },
    triggerDisabled: { opacity: 0.5 },
    value: { flex: 1, fontSize: 15, color: colors.text },
    placeholder: { flex: 1, fontSize: 15, color: colors.textMuted },
    panel: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.background,
      overflow: "hidden",
    },
    list: { maxHeight: MAX_LIST_HEIGHT },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: 12,
      paddingTop: 12,
      paddingBottom: 4,
    },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontSize: 15, color: colors.text },
    rowLabelActive: { color: colors.accent, fontWeight: "600" },
    rowDetail: { fontSize: 11, color: colors.textMuted },
    empty: { padding: 16, fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  });
