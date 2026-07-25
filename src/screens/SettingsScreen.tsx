import * as Clipboard from "expo-clipboard";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadModels } from "../settings/modelCatalogue";
import { CatalogueModel, groupModels } from "../settings/modelList";
import { ModelSelection } from "../settings/modelSelection";
import { describeProvider, PROVIDERS, ProviderId } from "../settings/providers";
import {
  clearProviderKey,
  getConfiguredProviderIds,
  getProviderKey,
  getSelectedModel,
  setProviderKey,
  setSelectedModel,
} from "../settings/secureSettings";
import { validateApiKey } from "../settings/validateApiKey";
import { Icon, IconName } from "../theme/icons";
import { Palette } from "../theme/palette";
import { ThemePreference, useTheme } from "../theme/ThemeContext";
import { PickerModal, PickerSection } from "./PickerModal";

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "light" },
  { value: "dark", label: "Dark", icon: "dark" },
  { value: "system", label: "System", icon: "system" },
];

type Props = { onBack: () => void };

/**
 * Must stay at module scope. Defined inside SettingsScreen it was a new
 * component *type* on every render, so React unmounted and remounted the whole
 * subtree — including the API key TextInput — on every keystroke, dropping
 * focus and the keyboard each character.
 */
function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Icon name={icon} size={17} color={colors.accent} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "validating" }
  | { kind: "valid" }
  | { kind: "invalid"; message: string };

export function SettingsScreen({ onBack }: Props) {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /** Keys held in the form, per provider. A provider is "added" once it has an entry. */
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [revealed, setRevealed] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [status, setStatus] = useState<SaveState>({ kind: "idle" });

  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueStale, setCatalogueStale] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState("");

  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const addedProviders = useMemo(() => Object.keys(keys) as ProviderId[], [keys]);
  const unaddedProviders = useMemo(
    () => PROVIDERS.filter((provider) => !(provider.id in keys)),
    [keys],
  );

  useEffect(() => {
    (async () => {
      const [configured, storedSelection] = await Promise.all([getConfiguredProviderIds(), getSelectedModel()]);
      const loaded: Partial<Record<ProviderId, string>> = {};
      await Promise.all(
        configured.map(async (id) => {
          loaded[id] = (await getProviderKey(id)) ?? "";
        }),
      );
      setKeys(loaded);
      setSelection(storedSelection);
      if (storedSelection) setManualModel(storedSelection.modelId);
    })();
  }, []);

  const refreshModels = useCallback(async (providerIds: ProviderId[], currentKeys: Partial<Record<ProviderId, string>>) => {
    if (providerIds.length === 0) {
      setModels([]);
      setCatalogueError(null);
      setCatalogueStale(false);
      return;
    }
    setLoadingModels(true);
    const results = await Promise.all(
      providerIds.map((id) => loadModels(id, currentKeys[id]?.trim() || null)),
    );
    setModels(results.flatMap((result) => result.models));
    setCatalogueStale(results.some((result) => result.stale));
    const firstError = results.find((result) => result.error !== null)?.error ?? null;
    setCatalogueError(results.every((result) => result.models.length === 0) ? firstError : null);
    setLoadingModels(false);
  }, []);

  // Reloaded whenever the set of added providers changes: the list is the union
  // across them, so adding or removing one changes what should be on offer.
  useEffect(() => {
    void refreshModels(addedProviders, keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys are read, not tracked; a keystroke must not refetch
  }, [addedProviders.join(","), refreshModels]);

  const modelSections: PickerSection<string>[] = useMemo(
    () =>
      groupModels(models.filter((model) => addedProviders.includes(model.providerId))).map((group) => ({
        label: group.label,
        options: group.models.map((model) => ({ value: model.id, label: model.name, detail: model.id })),
      })),
    [models, addedProviders],
  );

  const handleAddProvider = (providerId: ProviderId) => {
    setKeys((current) => ({ ...current, [providerId]: "" }));
    setStatus({ kind: "idle" });
  };

  const handleRemoveProvider = async (providerId: ProviderId) => {
    await clearProviderKey(providerId);
    setKeys((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    // A selection served by a provider that's gone can't run, so it goes too.
    if (selection?.providerId === providerId) setSelection(null);
    setStatus({ kind: "idle" });
  };

  const handlePaste = async (providerId: ProviderId) => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      // Silence here is indistinguishable from a broken button. On the
      // simulator an empty clipboard usually means the host pasteboard never
      // synced across (see README), not that nothing was copied.
      setStatus({ kind: "invalid", message: "Clipboard is empty — nothing to paste." });
      return;
    }
    setKeys((current) => ({ ...current, [providerId]: text }));
    setStatus({ kind: "idle" });
  };

  /** Saving validates as a matter of course — two buttons for one intention was a step nobody expected. */
  const handleSave = async () => {
    await Promise.all(
      addedProviders.map((id) => setProviderKey(id, (keys[id] ?? "").trim())),
    );
    if (selection) await setSelectedModel(selection);
    setStatus({ kind: "saved" });

    if (!selection) return;
    const key = (keys[selection.providerId] ?? "").trim();
    if (!key) {
      setStatus({ kind: "invalid", message: `Add a key for ${describeProvider(selection.providerId).label} first.` });
      return;
    }

    setStatus({ kind: "validating" });
    const result = await validateApiKey(key, selection.modelId);
    setStatus(result.ok ? { kind: "valid" } : { kind: "invalid", message: result.message });
    if (result.ok) void refreshModels(addedProviders, keys);
  };

  const selectedLabel = useMemo(() => {
    if (!selection) return null;
    const found = models.find((model) => model.id === selection.modelId);
    return found ? found.name : selection.modelId;
  }, [selection, models]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.toolbar}>
        {/* Absolutely positioned so the title is centred on the screen rather
            than on whatever's left over beside an auto-width back button. */}
        <Text style={styles.toolbarTitle}>Settings</Text>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Icon name="back" size={24} color={colors.accent} />
          <Text style={styles.backText}>Notes</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // iOS insets the scroll view by the keyboard and scrolls the focused
        // field into view. Without it, the key and model fields sit under the
        // keyboard exactly when you're typing into them.
        automaticallyAdjustKeyboardInsets
      >
        <Section icon="appearance" title="Appearance">
          <View style={styles.appearanceRow}>
            {APPEARANCE_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setPreference(option.value)}
                  style={[styles.appearanceOption, selected && styles.appearanceOptionSelected]}
                >
                  <Icon name={option.icon} size={21} color={selected ? colors.accent : colors.textSecondary} />
                  <Text style={[styles.appearanceLabel, selected && { color: colors.accent }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        <Section icon="key" title="Providers">
          {addedProviders.length === 0 && (
            <Text style={styles.hint}>Add a provider to enable AI editing. Nothing is sent anywhere until you do.</Text>
          )}

          {addedProviders.map((providerId) => {
            const provider = describeProvider(providerId);
            return (
              <View key={providerId} style={styles.providerBlock}>
                <View style={styles.providerHeader}>
                  <Text style={styles.providerName}>{provider.label}</Text>
                  <Pressable onPress={() => void handleRemoveProvider(providerId)} hitSlop={8}>
                    <Icon name="delete" size={17} color={colors.danger} />
                  </Pressable>
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    value={keys[providerId] ?? ""}
                    onChangeText={(text) => setKeys((current) => ({ ...current, [providerId]: text }))}
                    placeholder={provider.keyPlaceholder}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!revealed[providerId]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.input, styles.inputFlex]}
                  />
                  <Pressable
                    onPress={() => setRevealed((current) => ({ ...current, [providerId]: !current[providerId] }))}
                    hitSlop={8}
                    style={styles.inputIconButton}
                  >
                    <Icon name={revealed[providerId] ? "conceal" : "reveal"} size={19} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => void handlePaste(providerId)} hitSlop={8} style={styles.inputIconButton}>
                    <Icon name="clipboard" size={19} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.hint}>{provider.keyHint}</Text>
              </View>
            );
          })}

          {unaddedProviders.length > 0 && (
            <Pressable style={styles.addRow} onPress={() => setProviderPickerOpen(true)}>
              <Icon name="add" size={18} color={colors.accent} />
              <Text style={styles.addText}>Add provider</Text>
            </Pressable>
          )}

          <Text style={styles.hint}>Keys are stored in this device's secure keychain, and only sent to their own provider.</Text>
        </Section>

        <Section icon="model" title="Model">
          <Pressable
            style={[styles.select, addedProviders.length === 0 && styles.selectDisabled]}
            disabled={addedProviders.length === 0}
            onPress={() => setModelPickerOpen(true)}
          >
            <Text style={selectedLabel ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
              {addedProviders.length === 0 ? "Add a provider first" : (selectedLabel ?? "Choose a model")}
            </Text>
            {loadingModels ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Icon name="dismissKeyboard" size={18} color={colors.textSecondary} />
            )}
          </Pressable>

          {selection && selectedLabel !== selection.modelId && (
            <Text style={styles.hint}>{selection.modelId}</Text>
          )}

          {catalogueStale && <Text style={styles.hint}>Showing the last known list — the provider couldn't be reached.</Text>}

          {catalogueError && (
            <View style={styles.fallbackBlock}>
              <Text style={styles.errorText}>{catalogueError}</Text>
              {/* The escape hatch: unable to reach the network must never leave
                  someone unable to set a model at all. */}
              <TextInput
                value={manualModel}
                onChangeText={setManualModel}
                onEndEditing={() =>
                  manualModel.trim() &&
                  setSelection({ providerId: addedProviders[0] ?? "openrouter", modelId: manualModel.trim() })
                }
                placeholder="Or type a model id, e.g. openai/gpt-4o-mini"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
          )}

          <Text style={styles.hint}>Only models that support tool calling are listed — the agent can't work without it.</Text>
        </Section>

        <View style={styles.saveRow}>
          <Pressable onPress={() => void handleSave()} style={[styles.button, styles.primaryButton]}>
            <Icon name="save" size={15} color={colors.accentText} />
            <Text style={styles.primaryButtonText}>{status.kind === "validating" ? "Checking…" : "Save"}</Text>
          </Pressable>
        </View>

        {status.kind === "saved" && <Text style={styles.successText}>Saved.</Text>}
        {status.kind === "valid" && <Text style={styles.successText}>✓ Saved — key and model work.</Text>}
        {status.kind === "invalid" && <Text style={styles.errorText}>{status.message}</Text>}

        <Section icon="about" title="About">
          <Text style={styles.aboutText}>
            anotAI — notes are markdown files stored only on this device. In this mode, nothing you write ever leaves
            the device except the text sent to your provider when you ask the AI to edit a note.
          </Text>
        </Section>
      </ScrollView>

      <PickerModal
        visible={providerPickerOpen}
        title="Add a provider"
        selected={null}
        sections={[{ options: unaddedProviders.map((provider) => ({ value: provider.id, label: provider.label })) }]}
        onSelect={(value) => handleAddProvider(value as ProviderId)}
        onClose={() => setProviderPickerOpen(false)}
        emptyMessage="Every supported provider is already added."
      />

      <PickerModal
        visible={modelPickerOpen}
        title="Choose a model"
        selected={selection?.modelId ?? null}
        sections={modelSections}
        onSelect={(modelId) => {
          const found = models.find((model) => model.id === modelId);
          setSelection({ providerId: found?.providerId ?? addedProviders[0] ?? "openrouter", modelId });
          setStatus({ kind: "idle" });
        }}
        onClose={() => setModelPickerOpen(false)}
        emptyMessage={loadingModels ? "Loading models…" : "No tool-calling models available."}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: { position: "absolute", left: 12, flexDirection: "row", alignItems: "center" },
    backText: { color: colors.accent, fontSize: 16, fontWeight: "600", marginLeft: 2 },
    toolbarTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
    content: { padding: 16, gap: 14, paddingBottom: 40 },
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
    providerBlock: { gap: 8, paddingBottom: 4 },
    providerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    providerName: { fontSize: 14, fontWeight: "600", color: colors.text },
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
    addRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    addText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
    select: {
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
    selectDisabled: { opacity: 0.5 },
    selectValue: { flex: 1, fontSize: 15, color: colors.text },
    selectPlaceholder: { flex: 1, fontSize: 15, color: colors.textMuted },
    fallbackBlock: { gap: 8 },
    hint: { fontSize: 12, color: colors.textMuted },
    saveRow: { flexDirection: "row" },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 18,
      paddingVertical: 11,
      borderRadius: 8,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryButtonText: { color: colors.accentText, fontWeight: "700" },
    successText: { color: colors.success },
    errorText: { color: colors.danger },
    aboutText: { fontSize: 13, color: colors.textSecondary, lineHeight: 19 },
  });
