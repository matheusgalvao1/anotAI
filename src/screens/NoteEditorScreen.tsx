import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";
import { AGENT_CONFIG, AgentProviderError, CanonicalMessage, OpenRouterProvider, runTurn } from "../agent";
import { FileNoteStore } from "../notes/agentNoteStore";
import { readNote, writeNote } from "../notes/noteRepository";
import { deriveTitleAndPreview } from "../notes/title";
import { SnapshotUndoStack } from "../notes/undoStack";
import { getApiKey, getDefaultModel } from "../settings/secureSettings";
import { Palette } from "../theme/palette";
import { useTheme } from "../theme/ThemeContext";
import { AgentFab } from "./AgentFab";

const SAVE_DEBOUNCE_MS = 500;
const STATUS_CLEAR_MS = 30_000;

type Props = { noteId: string; onBack: () => void };

type TurnStatus = { kind: "working" | "success" | "none" | "error" | "cancelled"; text: string } | null;

function describeTurnError(err: unknown): string {
  if (err instanceof AgentProviderError) {
    switch (err.providerError.kind) {
      case "auth":
        return "Your OpenRouter key was rejected. Check it in Settings.";
      case "insufficient_credits":
        return "Your OpenRouter account is out of credits.";
      case "rate_limit":
        return "OpenRouter rate-limited this request. Try again in a moment.";
      case "not_found":
        return "That model isn't available on OpenRouter. Check the model name in Settings.";
      case "no_tool_support":
        return "This model doesn't support tool calling. Try a different model in Settings.";
      case "timeout":
        return "The request timed out.";
      case "network":
        return "No internet connection, or OpenRouter is unreachable.";
      default:
        return err.providerError.message || "Something went wrong.";
    }
  }
  if (err instanceof Error && err.name === "AbortError") return "Cancelled";
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function NoteEditorScreen({ noteId, onBack }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [body, setBody] = useState(() => readNote(noteId));
  const [previewing, setPreviewing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [turnBusy, setTurnBusy] = useState(false);
  const [turnStatus, setTurnStatus] = useState<TurnStatus>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>("Checking for an OpenRouter key…");

  const bodyRef = useRef(body);
  const undoStackRef = useRef(new SnapshotUndoStack(body));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<CanonicalMessage[]>([]);
  const turnAbortRef = useRef<AbortController | null>(null);
  const credentialsRef = useRef<{ apiKey: string; model: string } | null>(null);

  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  // No key/model in Settings, or the note is too large to send at all — both
  // disable AI editing with an explanation rather than letting a turn fail.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [apiKey, model] = await Promise.all([getApiKey(), getDefaultModel()]);
      if (cancelled) return;
      if (new TextEncoder().encode(bodyRef.current).length > AGENT_CONFIG.MAX_NOTE_BYTES) {
        setDisabledReason("This note is too large for AI editing.");
        return;
      }
      if (!apiKey || !model) {
        setDisabledReason("Set your OpenRouter API key in Settings to enable AI editing.");
        return;
      }
      credentialsRef.current = { apiKey, model };
      setDisabledReason(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(
    (next: string) => {
      undoStackRef.current.push(next);
      setCanUndo(undoStackRef.current.canUndo());
      setCanRedo(undoStackRef.current.canRedo());
      writeNote(noteId, next);
    },
    [noteId],
  );

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      commit(bodyRef.current);
    }
  }, [commit]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      subscription.remove();
      flush();
      if (statusTimer.current) clearTimeout(statusTimer.current);
      turnAbortRef.current?.abort();
    };
  }, [flush]);

  const handleChangeText = useCallback(
    (next: string) => {
      setBody(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => commit(next), SAVE_DEBOUNCE_MS);
    },
    [commit],
  );

  const handleUndo = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const restored = undoStackRef.current.undo();
    setBody(restored);
    setCanUndo(undoStackRef.current.canUndo());
    setCanRedo(undoStackRef.current.canRedo());
    writeNote(noteId, restored);
  }, [noteId]);

  const handleRedo = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const restored = undoStackRef.current.redo();
    setBody(restored);
    setCanUndo(undoStackRef.current.canUndo());
    setCanRedo(undoStackRef.current.canRedo());
    writeNote(noteId, restored);
  }, [noteId]);

  const handleBack = useCallback(() => {
    flush();
    onBack();
  }, [flush, onBack]);

  const setTransientStatus = useCallback((status: TurnStatus) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setTurnStatus(status);
    if (status) statusTimer.current = setTimeout(() => setTurnStatus(null), STATUS_CLEAR_MS);
  }, []);

  const handleSubmitPrompt = useCallback(
    async (prompt: string) => {
      if (turnBusy || !credentialsRef.current) return;
      flush(); // agent reads the file directly — make sure the latest typed text is on disk first

      const controller = new AbortController();
      turnAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), AGENT_CONFIG.REQUEST_TIMEOUT_MS);

      setTurnBusy(true);
      setTransientStatus({ kind: "working", text: "Thinking…" });

      try {
        const { apiKey, model } = credentialsRef.current;
        const provider = new OpenRouterProvider({ apiKey, model, title: "anotAI" });
        const store = new FileNoteStore(noteId);
        const noteTitle = deriveTitleAndPreview(bodyRef.current).title;

        const result = await runTurn({
          prompt,
          noteTitle,
          store,
          history: historyRef.current,
          provider,
          signal: controller.signal,
        });

        historyRef.current = result.updatedHistory;

        if (result.bodyChanged) {
          setBody(result.newBody);
          bodyRef.current = result.newBody;
          undoStackRef.current.push(result.newBody);
          setCanUndo(undoStackRef.current.canUndo());
          setCanRedo(undoStackRef.current.canRedo());
        }

        if (result.stoppedReason === "cancelled") {
          setTransientStatus({ kind: "cancelled", text: "Cancelled" });
        } else if (!result.bodyChanged) {
          setTransientStatus({ kind: "none", text: result.finalText || "No changes made" });
        } else {
          setTransientStatus({ kind: "success", text: result.finalText || "Done" });
        }
      } catch (err) {
        setTransientStatus({ kind: "error", text: describeTurnError(err) });
      } finally {
        clearTimeout(timeout);
        turnAbortRef.current = null;
        setTurnBusy(false);
      }
    },
    [turnBusy, flush, noteId, setTransientStatus],
  );

  const handleCancelTurn = useCallback(() => {
    turnAbortRef.current?.abort();
  }, []);

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

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {previewing ? (
          <View style={styles.previewContainer}>
            <Markdown>{body}</Markdown>
          </View>
        ) : (
          <TextInput
            autoFocus
            multiline
            editable={!turnBusy}
            value={body}
            onChangeText={handleChangeText}
            style={[styles.input, turnBusy && styles.inputBusy]}
            placeholderTextColor={colors.textMuted}
            textAlignVertical="top"
            placeholder="Start writing…"
          />
        )}

        <AgentFab
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          busy={turnBusy}
          onCancel={handleCancelTurn}
          onSubmit={handleSubmitPrompt}
          disabledReason={disabledReason}
        />
      </KeyboardAvoidingView>

      {turnStatus && (
        <Text style={[styles.statusLine, styles[`status_${turnStatus.kind}`]]} numberOfLines={2}>
          {turnStatus.text}
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
    statusLine: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 6 },
    status_working: { color: colors.textSecondary },
    status_success: { color: colors.success },
    status_none: { color: colors.textMuted },
    status_error: { color: colors.danger },
    status_cancelled: { color: colors.textMuted },
  });
