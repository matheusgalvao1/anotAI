import * as Clipboard from "expo-clipboard";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loadModels } from "../settings/modelCatalogue";
import { CatalogueModel, sortModels } from "../settings/modelList";
import { ModelSelection } from "../settings/modelSelection";
import { describeProvider, PROVIDERS, ProviderId } from "../settings/providers";
import {
  clearSelectedModel,
  getProviderKey,
  getSelectedModel,
  setProviderKey,
  setSelectedModel,
} from "../settings/secureSettings";
import { validateApiKey } from "../settings/validateApiKey";
import { Icon, IconName } from "../theme/icons";
import { Palette } from "../theme/palette";
import { ThemePreference, useTheme } from "../theme/ThemeContext";
import { Dropdown } from "./Dropdown";

/** Matches the editor's own debounce, so "saving" feels the same everywhere. */
const SAVE_DEBOUNCE_MS = 500;

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "light" },
  { value: "dark", label: "Dark", icon: "dark" },
  { value: "system", label: "System", icon: "system" },
];

type Keys = Partial<Record<ProviderId, string>>;

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

  const [keys, setKeys] = useState<Keys>({});
  const [revealed, setRevealed] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [validating, setValidating] = useState<ProviderId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  /**
   * The provider chosen in the Model section. Held apart from `selection`, which
   * only exists once a model has been picked too — you can have chosen a provider
   * and not yet a model.
   */
  const [providerId, setProviderId] = useState<ProviderId | null>(null);
  const [selection, setSelection] = useState<ModelSelection | null>(null);

  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [catalogueStale, setCatalogueStale] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModel, setManualModel] = useState("");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Read by the unmount flush, which must not re-bind on every keystroke. */
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    (async () => {
      const loaded: Keys = {};
      await Promise.all(
        PROVIDERS.map(async (provider) => {
          loaded[provider.id] = (await getProviderKey(provider.id)) ?? "";
        }),
      );
      const stored = await getSelectedModel();
      setKeys(loaded);
      setSelection(stored);
      setProviderId(stored?.providerId ?? null);
      if (stored) setManualModel(stored.modelId);
    })();
  }, []);

  const persistKeys = useCallback(async (next: Keys) => {
    await Promise.all((Object.keys(next) as ProviderId[]).map((id) => setProviderKey(id, (next[id] ?? "").trim())));
  }, []);

  /** There is no Save button, so every edit schedules its own write. */
  const editKey = useCallback(
    (id: ProviderId, text: string) => {
      setFeedback(null);
      setKeys((current) => {
        const next = { ...current, [id]: text };
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

  /** Only the chosen provider's catalogue is fetched — the model list is scoped to it. */
  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setCatalogueError(null);
      setCatalogueStale(false);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    void loadModels(providerId, keysRef.current[providerId]?.trim() || null).then((result) => {
      if (cancelled) return;
      setModels(result.models);
      setCatalogueStale(result.stale);
      setCatalogueError(result.error);
      setLoadingModels(false);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const modelOptions = useMemo(
    () => sortModels(models).map((model) => ({ value: model.id, label: model.name, detail: model.id })),
    [models],
  );

  const chooseProvider = async (next: ProviderId) => {
    setProviderId(next);
    setFeedback(null);
    // A model from the previous provider can't be served by this one, so it goes.
    if (selection && selection.providerId !== next) {
      await clearSelectedModel();
      setSelection(null);
      setManualModel("");
    }
  };

  const handlePaste = async (id: ProviderId) => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      // Silence here is indistinguishable from a broken button. On the
      // simulator an empty clipboard usually means the host pasteboard never
      // synced across (see README), not that nothing was copied.
      setFeedback({ kind: "error", message: "Clipboard is empty — nothing to paste." });
      return;
    }
    editKey(id, text);
  };

  const handleValidate = async (id: ProviderId) => {
    const provider = describeProvider(id);
    if (!provider.supported) {
      setFeedback({ kind: "error", message: `${provider.label} isn't supported yet.` });
      return;
    }
    const key = (keys[id] ?? "").trim();
    if (!key) {
      setFeedback({ kind: "error", message: "Enter a key first." });
      return;
    }
    if (!selection || selection.providerId !== id) {
      setFeedback({ kind: "error", message: `Choose a ${provider.label} model below first.` });
      return;
    }

    // Validating uses the key in the field, which may not have been written yet.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await persistKeys(keys);
    }

    setValidating(id);
    const result = await validateApiKey(key, selection.modelId);
    setValidating(null);
    setFeedback(result.ok ? { kind: "ok", message: "Key and model work." } : { kind: "error", message: result.message });
  };

  const selectedModelLabel = useMemo(() => {
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

        <Section icon="key" title="API keys">
          {PROVIDERS.map((provider) => (
            <View key={provider.id} style={styles.providerBlock}>
              <View style={styles.providerHeader}>
                <Text style={styles.providerName}>{provider.label}</Text>
                {/* State, not explanation: this one's key can be stored but not used yet. */}
                {!provider.supported && <Text style={styles.badge}>not supported yet</Text>}
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  value={keys[provider.id] ?? ""}
                  onChangeText={(text) => editKey(provider.id, text)}
                  placeholder={provider.keyPlaceholder}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!revealed[provider.id]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.inputFlex]}
                />
                <Pressable
                  onPress={() => setRevealed((current) => ({ ...current, [provider.id]: !current[provider.id] }))}
                  hitSlop={8}
                  style={styles.inputIconButton}
                >
                  <Icon name={revealed[provider.id] ? "conceal" : "reveal"} size={19} color={colors.textSecondary} />
                </Pressable>
                <Pressable onPress={() => void handlePaste(provider.id)} hitSlop={8} style={styles.inputIconButton}>
                  <Icon name="clipboard" size={19} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => void handleValidate(provider.id)}
                  hitSlop={8}
                  style={styles.inputIconButton}
                  disabled={validating !== null}
                  accessibilityLabel={`Check the ${provider.label} key`}
                >
                  {validating === provider.id ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : (
                    <Icon name="validate" size={19} color={colors.textSecondary} />
                  )}
                </Pressable>
              </View>
            </View>
          ))}

          {feedback && (
            <Text style={feedback.kind === "ok" ? styles.successText : styles.errorText}>{feedback.message}</Text>
          )}
        </Section>

        <Section icon="model" title="Model">
          <Dropdown
            placeholder="Choose a provider"
            selected={providerId}
            selectedLabel={providerId ? describeProvider(providerId).label : null}
            sections={[
              {
                options: PROVIDERS.map((provider) => ({
                  value: provider.id,
                  label: provider.label,
                  detail: provider.supported ? undefined : "not supported yet",
                })),
              },
            ]}
            onSelect={(value) => void chooseProvider(value as ProviderId)}
          />

          <Dropdown
            placeholder={providerId ? "Choose a model" : "Choose a provider first"}
            selected={selection?.modelId ?? null}
            selectedLabel={selectedModelLabel}
            sections={[{ options: modelOptions }]}
            disabled={!providerId}
            loading={loadingModels}
            emptyMessage={loadingModels ? "Loading models…" : (catalogueError ?? "No tool-calling models available.")}
            onSelect={(modelId) => {
              if (!providerId) return;
              const next = { providerId, modelId };
              setSelection(next);
              void setSelectedModel(next);
              setFeedback(null);
            }}
          />

          {/* State, not explanation: the list on screen may be out of date. */}
          {catalogueStale && <Text style={styles.noticeText}>Showing the last known list — the provider couldn't be reached.</Text>}

          {providerId && catalogueError && (
            <View style={styles.fallbackBlock}>
              <Text style={styles.errorText}>{catalogueError}</Text>
              {/* The escape hatch: unable to reach the network must never leave
                  someone unable to set a model at all. */}
              <TextInput
                value={manualModel}
                onChangeText={setManualModel}
                onEndEditing={() => {
                  const modelId = manualModel.trim();
                  if (!modelId || !providerId) return;
                  const next = { providerId, modelId };
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
    providerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    providerName: { fontSize: 14, fontWeight: "600", color: colors.text },
    badge: { fontSize: 11, color: colors.textMuted },
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
