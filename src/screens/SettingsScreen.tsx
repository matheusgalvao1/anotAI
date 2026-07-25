import * as Clipboard from "expo-clipboard";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadModels } from "../settings/modelCatalogue";
import { CatalogueModel, groupModels } from "../settings/modelList";
import { ModelSelection } from "../settings/modelSelection";
import { describeProvider, PROVIDERS, ProviderId } from "../settings/providers";
import {
  clearProviderKey,
  clearSelectedModel,
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
import { Dropdown, DropdownSection } from "./Dropdown";

/** Matches the editor's own debounce, so "saving" feels the same everywhere. */
const SAVE_DEBOUNCE_MS = 500;

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

type Feedback = { kind: "ok" | "error"; message: string } | null;

export function SettingsScreen({ onBack }: Props) {
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /** Keys held in the form, per provider. A provider is "added" once it has an entry. */
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({});
  const [revealed, setRevealed] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [validating, setValidating] = useState<ProviderId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueStale, setCatalogueStale] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read by the unmount flush, which must not re-bind on every keystroke. */
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const addedProviders = useMemo(() => Object.keys(keys) as ProviderId[], [keys]);
  const unaddedProviders = useMemo(() => PROVIDERS.filter((provider) => !(provider.id in keys)), [keys]);

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

  const persistKeys = useCallback(async (next: Partial<Record<ProviderId, string>>) => {
    await Promise.all(
      (Object.keys(next) as ProviderId[]).map((id) => setProviderKey(id, (next[id] ?? "").trim())),
    );
  }, []);

  /** There is no Save button, so every edit schedules its own write. */
  const editKey = useCallback(
    (providerId: ProviderId, text: string) => {
      setFeedback(null);
      setKeys((current) => {
        const next = { ...current, [providerId]: text };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null;
          void persistKeys(next);
        }, SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [persistKeys],
  );

  // Leaving the screen must not drop a key typed in the last half-second.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        void persistKeys(keysRef.current);
      }
    },
    [persistKeys],
  );

  const refreshModels = useCallback(
    async (providerIds: ProviderId[], currentKeys: Partial<Record<ProviderId, string>>) => {
      if (providerIds.length === 0) {
        setModels([]);
        setCatalogueError(null);
        setCatalogueStale(false);
        return;
      }
      setLoadingModels(true);
      const results = await Promise.all(providerIds.map((id) => loadModels(id, currentKeys[id]?.trim() || null)));
      setModels(results.flatMap((result) => result.models));
      setCatalogueStale(results.some((result) => result.stale));
      const firstError = results.find((result) => result.error !== null)?.error ?? null;
      setCatalogueError(results.every((result) => result.models.length === 0) ? firstError : null);
      setLoadingModels(false);
    },
    [],
  );

  // Reloaded whenever the set of added providers changes: the list is the union
  // across them, so adding or removing one changes what should be on offer.
  useEffect(() => {
    void refreshModels(addedProviders, keysRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keys are read, not tracked; a keystroke must not refetch
  }, [addedProviders.join(","), refreshModels]);

  const modelSections: DropdownSection<string>[] = useMemo(
    () =>
      groupModels(models.filter((model) => addedProviders.includes(model.providerId))).map((group) => ({
        label: group.label,
        options: group.models.map((model) => ({ value: model.id, label: model.name, detail: model.id })),
      })),
    [models, addedProviders],
  );

  const handleAddProvider = (providerId: ProviderId) => {
    setFeedback(null);
    setKeys((current) => ({ ...current, [providerId]: "" }));
  };

  const handleRemoveProvider = async (providerId: ProviderId) => {
    await clearProviderKey(providerId);
    setKeys((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    // A selection served by a provider that's gone can't run, so it goes too.
    if (selection?.providerId === providerId) {
      await clearSelectedModel();
      setSelection(null);
    }
    setFeedback(null);
  };

  const handlePaste = async (providerId: ProviderId) => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      // Silence here is indistinguishable from a broken button. On the
      // simulator an empty clipboard usually means the host pasteboard never
      // synced across (see README), not that nothing was copied.
      setFeedback({ kind: "error", message: "Clipboard is empty — nothing to paste." });
      return;
    }
    editKey(providerId, text);
  };

  const handleValidate = async (providerId: ProviderId) => {
    const key = (keys[providerId] ?? "").trim();
    if (!key) {
      setFeedback({ kind: "error", message: "Enter a key first." });
      return;
    }
    if (!selection || selection.providerId !== providerId) {
      setFeedback({ kind: "error", message: `Choose a ${describeProvider(providerId).label} model first.` });
      return;
    }

    // Validating uses the key in the field, which may not have been written yet.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await persistKeys(keys);
    }

    setValidating(providerId);
    const result = await validateApiKey(key, selection.modelId);
    setValidating(null);
    setFeedback(result.ok ? { kind: "ok", message: "Key and model work." } : { kind: "error", message: result.message });
    if (result.ok) void refreshModels(addedProviders, keys);
  };

  const selectedLabel = useMemo(() => {
    if (!selection) return null;
    return models.find((model) => model.id === selection.modelId)?.name ?? selection.modelId;
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
          {addedProviders.map((providerId) => (
            <View key={providerId} style={styles.providerBlock}>
              <View style={styles.providerHeader}>
                <Text style={styles.providerName}>{describeProvider(providerId).label}</Text>
                <Pressable onPress={() => void handleRemoveProvider(providerId)} hitSlop={8}>
                  <Icon name="delete" size={17} color={colors.danger} />
                </Pressable>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  value={keys[providerId] ?? ""}
                  onChangeText={(text) => editKey(providerId, text)}
                  placeholder={describeProvider(providerId).keyPlaceholder}
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
                <Pressable
                  onPress={() => void handleValidate(providerId)}
                  hitSlop={8}
                  style={styles.inputIconButton}
                  disabled={validating !== null}
                  accessibilityLabel="Check this key and model"
                >
                  {validating === providerId ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <Icon name="validate" size={19} color={colors.textSecondary} />
                  )}
                </Pressable>
              </View>
            </View>
          ))}

          {unaddedProviders.length > 0 && (
            <Dropdown
              placeholder="Add provider"
              selected={null}
              sections={[{ options: unaddedProviders.map((provider) => ({ value: provider.id, label: provider.label })) }]}
              onSelect={(value) => handleAddProvider(value as ProviderId)}
            />
          )}

          {feedback && (
            <Text style={feedback.kind === "ok" ? styles.successText : styles.errorText}>{feedback.message}</Text>
          )}
        </Section>

        <Section icon="model" title="Model">
          <Dropdown
            placeholder={addedProviders.length === 0 ? "Add a provider first" : "Choose a model"}
            selected={selection?.modelId ?? null}
            selectedLabel={selectedLabel}
            sections={modelSections}
            disabled={addedProviders.length === 0}
            loading={loadingModels}
            emptyMessage={loadingModels ? "Loading models…" : "No tool-calling models available."}
            onSelect={(modelId) => {
              const found = models.find((model) => model.id === modelId);
              const next = { providerId: found?.providerId ?? addedProviders[0] ?? "openrouter", modelId };
              setSelection(next);
              void setSelectedModel(next);
              setFeedback(null);
            }}
          />

          {/* State, not explanation: the list on screen may be out of date. */}
          {catalogueStale && <Text style={styles.noticeText}>Showing the last known list — the provider couldn't be reached.</Text>}

          {catalogueError && (
            <View style={styles.fallbackBlock}>
              <Text style={styles.errorText}>{catalogueError}</Text>
              {/* The escape hatch: unable to reach the network must never leave
                  someone unable to set a model at all. */}
              <TextInput
                value={manualModel}
                onChangeText={setManualModel}
                onEndEditing={() => {
                  const modelId = manualModel.trim();
                  if (!modelId) return;
                  const next = { providerId: addedProviders[0] ?? "openrouter", modelId };
                  setSelection(next);
                  void setSelectedModel(next);
                }}
                placeholder="Or type a model id, e.g. openai/gpt-4o-mini"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
          )}
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
    providerBlock: { gap: 8 },
    providerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    providerName: { fontSize: 14, fontWeight: "600", color: colors.text },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
    fallbackBlock: { gap: 8 },
    noticeText: { fontSize: 12, color: colors.textMuted },
    successText: { color: colors.success, fontSize: 13 },
    errorText: { color: colors.danger, fontSize: 13 },
  });
