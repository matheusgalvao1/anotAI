import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  clearApiKey,
  getApiKey,
  getDefaultModel,
  setApiKey as storeApiKey,
  setDefaultModel as storeDefaultModel,
} from "../settings/secureSettings";
import { validateApiKey } from "../settings/validateApiKey";
import { Palette } from "../theme/palette";
import { ThemePreference, useTheme } from "../theme/ThemeContext";

const SUGGESTED_MODELS = ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"];

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
  { value: "system", label: "System", icon: "phone-portrait-outline" },
];

type Props = { onBack: () => void };

type Status =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "validating" }
  | { kind: "valid" }
  | { kind: "invalid"; message: string };

export function SettingsScreen({ onBack }: Props) {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [apiKey, setApiKeyInput] = useState("");
  const [model, setModelInput] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    (async () => {
      const [key, storedModel] = await Promise.all([getApiKey(), getDefaultModel()]);
      setApiKeyInput(key ?? "");
      setModelInput(storedModel ?? "");
    })();
  }, []);

  const handleSave = async () => {
    await storeApiKey(apiKey.trim());
    await storeDefaultModel(model.trim());
    setStatus({ kind: "saved" });
  };

  const handleValidate = async () => {
    if (!apiKey.trim() || !model.trim()) {
      setStatus({ kind: "invalid", message: "Enter both a key and a model first." });
      return;
    }
    setStatus({ kind: "validating" });
    const result = await validateApiKey(apiKey.trim(), model.trim());
    setStatus(result.ok ? { kind: "valid" } : { kind: "invalid", message: result.message });
  };

  const handleClear = async () => {
    await clearApiKey();
    setApiKeyInput("");
    setStatus({ kind: "idle" });
  };

  const handlePaste = async () => {
    // Reads the clipboard directly via Expo's native module — a different
    // path from the TextInput's own paste gesture, which iOS Simulator's
    // secureTextEntry fields don't always surface reliably.
    const text = await Clipboard.getStringAsync();
    if (text) setApiKeyInput(text.trim());
  };

  const Section = ({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: ReactNode }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={19} color={colors.accent} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.toolbar}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Ionicons name="chevron-back" size={26} color={colors.accent} />
          <Text style={styles.backText}>Notes</Text>
        </Pressable>
        <Text style={styles.toolbarTitle}>Settings</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Section icon="color-palette-outline" title="Appearance">
          <View style={styles.appearanceRow}>
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setPreference(option.value)}
                  style={[styles.appearanceOption, selected && styles.appearanceOptionSelected]}
                >
                  <Ionicons name={option.icon} size={22} color={selected ? colors.accent : colors.textSecondary} />
                  <Text style={[styles.appearanceLabel, selected && { color: colors.accent }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section icon="key-outline" title="OpenRouter API key">
          <View style={styles.inputRow}>
            <TextInput
              value={apiKey}
              onChangeText={setApiKeyInput}
              placeholder="sk-or-v1-…"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!keyVisible}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.inputFlex]}
            />
            <Pressable onPress={() => setKeyVisible((v) => !v)} hitSlop={8} style={styles.inputIconButton}>
              <Ionicons name={keyVisible ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textSecondary} />
            </Pressable>
            <Pressable onPress={handlePaste} hitSlop={8} style={styles.inputIconButton}>
              <Ionicons name="clipboard-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.hint}>Stored in this device's secure keychain. Never sent anywhere except to OpenRouter.</Text>

          <View style={styles.buttonRow}>
            <Pressable onPress={handleSave} style={[styles.button, styles.primaryButton]}>
              <Ionicons name="checkmark" size={16} color={colors.accentText} />
              <Text style={styles.primaryButtonText}>Save</Text>
            </Pressable>
            <Pressable onPress={handleValidate} style={styles.button}>
              <Ionicons name="flash-outline" size={16} color={colors.text} />
              <Text style={styles.buttonText}>{status.kind === "validating" ? "Checking…" : "Validate"}</Text>
            </Pressable>
            <Pressable onPress={handleClear} style={styles.button}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.dangerButtonText}>Clear</Text>
            </Pressable>
          </View>

          {status.kind === "saved" && <Text style={styles.successText}>Saved.</Text>}
          {status.kind === "valid" && <Text style={styles.successText}>✓ Key and model work.</Text>}
          {status.kind === "invalid" && <Text style={styles.errorText}>{status.message}</Text>}
        </Section>

        <Section icon="hardware-chip-outline" title="Model">
          <TextInput
            value={model}
            onChangeText={setModelInput}
            placeholder="e.g. openai/gpt-4o-mini"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.suggestionsRow}>
            {SUGGESTED_MODELS.map((m) => (
              <Pressable key={m} onPress={() => setModelInput(m)} style={styles.suggestionChip}>
                <Text style={styles.suggestionText}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            Any tool-calling-capable model slug from openrouter.ai/models works — this list is just a starting point.
          </Text>
        </Section>

        <Section icon="information-circle-outline" title="About">
          <Text style={styles.aboutText}>
            anotAI — notes are markdown files stored only on this device. In this mode, nothing you write ever leaves
            the device except the text sent to OpenRouter when you ask the AI to edit a note.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: { flexDirection: "row", alignItems: "center" },
    backText: { color: colors.accent, fontSize: 16, fontWeight: "600", marginLeft: 2 },
    toolbarTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
    content: { padding: 16, gap: 14 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
    cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
    appearanceRow: { flexDirection: "row", gap: 10 },
    appearanceOption: {
      flex: 1,
      alignItems: "center",
      gap: 6,
      paddingVertical: 14,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    appearanceOptionSelected: { borderColor: colors.accent, borderWidth: 1.5 },
    appearanceLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    inputFlex: { flex: 1 },
    inputIconButton: { padding: 4 },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.background,
    },
    hint: { fontSize: 12, color: colors.textMuted },
    suggestionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    suggestionChip: { backgroundColor: colors.background, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    suggestionText: { fontSize: 12, color: colors.textSecondary },
    buttonRow: { flexDirection: "row", gap: 10, marginTop: 4 },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
    buttonText: { color: colors.text, fontWeight: "600" },
    primaryButtonText: { color: colors.accentText, fontWeight: "700" },
    dangerButtonText: { color: colors.danger, fontWeight: "600" },
    successText: { color: colors.success, marginTop: 4 },
    errorText: { color: colors.danger, marginTop: 4 },
    aboutText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  });
