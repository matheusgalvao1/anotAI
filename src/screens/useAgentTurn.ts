import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_CONFIG,
  AgentProviderError,
  CanonicalMessage,
  NoteStoreError,
  OpenRouterProvider,
  runTurn,
  TURN_TIMEOUT,
} from "../agent";
import { FileNoteStore } from "../notes/agentNoteStore";
import { ChangedRange, changedRange } from "../notes/changedRange";
import { deriveTitleAndPreview } from "../notes/title";
import { getProviderKey, getSelectedModel } from "../settings/secureSettings";

const STATUS_CLEAR_MS = 30_000;
/** How long a change stays tinted before the editor comes back (PRD §7.5). */
const HIGHLIGHT_MS = 5_000;

export type TurnStatusKind = "working" | "success" | "none" | "error" | "cancelled";
export type TurnStatus = { kind: TurnStatusKind; text: string } | null;

/**
 * The note as one tool call left it, plus what that call changed. Carries its own
 * body rather than reading the session's: mid-turn writes haven't been adopted
 * into the editor yet, so the session's body is still the pre-turn text.
 */
export type ChangeHighlight = { body: string; range: ChangedRange } | null;

export type AgentTurn = {
  busy: boolean;
  status: TurnStatus;
  /** Non-null when AI editing can't be used at all, with a reason to show the user. */
  disabledReason: string | null;
  submit: (prompt: string) => Promise<void>;
  cancel: () => void;
  /**
   * Drops the status immediately. The 30 s auto-clear is only a backstop for a
   * status nobody dismissed — closing the prompt field is what normally ends
   * the conversation, and leaving the reply hanging around after that reads as
   * a bug (PRD §7.4).
   */
  clearStatus: () => void;
  /** The latest agent change to show tinted, or null when the editor should be live. */
  highlight: ChangeHighlight;
  /** Ends the highlight early and hands editing straight back. */
  dismissHighlight: () => void;
};

type Params = {
  noteId: string;
  /** Read at submit time so the prompt is answered against the freshest body. */
  bodyRef: React.RefObject<string>;
  /** Persists any pending debounced edit before the agent reads the file. */
  flush: () => void;
  /** Called with the new body when a turn changed the note. */
  onBodyChanged: (next: string) => void;
  /**
   * Called with the pre-turn body when a turn was aborted, so a half-applied
   * edit doesn't survive a cancel the user read as "nothing happened".
   */
  onRevert: (previous: string) => void;
  /** Called when storage itself failed, so the editor can surface it loudly. */
  onStorageError: (message: string) => void;
};

/**
 * `expo/fetch` is passed in explicitly rather than left to `globalThis.fetch`.
 * React Native's own fetch is `whatwg-fetch` over XHR and its `Response` exposes
 * no `body`, so SSE can't be read from it. Expo SDK 57 does swap the global for
 * its streaming implementation, but that's an implicit side effect gated on
 * `EXPO_PUBLIC_USE_RN_FETCH` — and the agent core is deliberately
 * framework-free, so it must not depend on an Expo runtime patch it can't see.
 */
function buildProvider(apiKey: string, model: string): OpenRouterProvider {
  return new OpenRouterProvider({ apiKey, model, title: "anotAI", fetch: expoFetch });
}

function describeTurnError(err: unknown): string {
  if (err instanceof NoteStoreError) return err.message;
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
      case "cancelled":
        return "Cancelled";
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

/**
 * Owns everything about running an agent turn against the open note:
 * credentials, provider construction, per-note conversation history,
 * cancellation and its deadline, and turning failures into human sentences.
 */
export function useAgentTurn({ noteId, bodyRef, flush, onBodyChanged, onRevert, onStorageError }: Params): AgentTurn {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TurnStatus>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>("Checking for an OpenRouter key…");
  const [highlight, setHighlight] = useState<ChangeHighlight>(null);

  const historyRef = useRef<CanonicalMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const credentialsRef = useRef<{ apiKey: string; model: string } | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const selection = await getSelectedModel();
      const apiKey = selection ? await getProviderKey(selection.providerId) : null;
      if (cancelled) return;
      if (!selection || !apiKey) {
        setDisabledReason("Add a provider and choose a model in Settings to enable AI editing.");
        return;
      }
      credentialsRef.current = { apiKey, model: selection.modelId };
      setDisabledReason(null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  const setTransientStatus = useCallback((next: TurnStatus) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(next);
    if (next) statusTimer.current = setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
  }, []);

  const clearStatus = useCallback(() => setTransientStatus(null), [setTransientStatus]);

  const dismissHighlight = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = null;
    setHighlight(null);
  }, []);

  const showHighlight = useCallback((body: string, range: ChangedRange) => {
    // Each write replaces the last rather than queueing behind it: a turn with
    // three patches would otherwise hold the editor for fifteen seconds.
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlight({ body, range });
    highlightTimer.current = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
  }, []);

  const submit = useCallback(
    async (prompt: string) => {
      if (busy || !credentialsRef.current) return;

      flush(); // the agent reads the file directly, so pending edits must be on disk first

      // Checked per turn rather than once on mount: a note grows while it's open,
      // and a stale gate would either block a note that shrank or admit one that grew.
      if (new TextEncoder().encode(bodyRef.current).length > AGENT_CONFIG.MAX_NOTE_BYTES) {
        setTransientStatus({ kind: "error", text: "This note is too large for AI editing." });
        return;
      }

      // Captured before anything runs: the note to restore to if this turn is
      // aborted part-way through a write.
      const preTurnBody = bodyRef.current;

      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(TURN_TIMEOUT), AGENT_CONFIG.REQUEST_TIMEOUT_MS);

      setBusy(true);
      dismissHighlight(); // a new prompt supersedes whatever the last one highlighted
      setTransientStatus({ kind: "working", text: "Thinking…" });

      try {
        const { apiKey, model } = credentialsRef.current;
        const result = await runTurn({
          prompt,
          noteTitle: deriveTitleAndPreview(bodyRef.current).title,
          store: new FileNoteStore(noteId),
          history: historyRef.current,
          provider: buildProvider(apiKey, model),
          signal: controller.signal,
          onNoteWritten: (before, after) => {
            const range = changedRange(before, after);
            if (range) showHighlight(after, range);
          },
        });

        historyRef.current = result.updatedHistory;

        const aborted = result.stoppedReason === "cancelled" || result.stoppedReason === "timed_out";
        // An aborted turn is an incomplete one: whatever it managed to write is
        // half of an edit nobody asked for, so it goes back rather than being
        // adopted. Only a turn that ran to completion changes the note.
        if (aborted) {
          // The note is going back to how it was, so a highlight over text that
          // no longer exists has to go with it.
          dismissHighlight();
          if (result.bodyChanged) onRevert(preTurnBody);
        } else if (result.bodyChanged) {
          onBodyChanged(result.newBody);
        }

        if (result.stoppedReason === "cancelled") {
          setTransientStatus({ kind: "cancelled", text: "Cancelled" });
        } else if (result.stoppedReason === "timed_out") {
          setTransientStatus({ kind: "error", text: "The request timed out." });
        } else if (!result.bodyChanged) {
          setTransientStatus({ kind: "none", text: result.finalText || "No changes made" });
        } else {
          setTransientStatus({ kind: "success", text: result.finalText || "Done" });
        }
      } catch (err) {
        // A storage failure is not a turn outcome — it means the note may not
        // have been written, which the editor has to say loudly.
        if (err instanceof NoteStoreError) {
          onStorageError(err.message);
          setTransientStatus({ kind: "error", text: describeTurnError(err) });
        } else if (controller.signal.aborted) {
          // The last line of defence. Whatever a transport throws when it's
          // cancelled, the aborted signal is the fact that matters — never show
          // the user a raw exception for something they did on purpose.
          dismissHighlight();
          onRevert(preTurnBody);
          const timedOut = controller.signal.reason === TURN_TIMEOUT;
          setTransientStatus(
            timedOut ? { kind: "error", text: "The request timed out." } : { kind: "cancelled", text: "Cancelled" },
          );
        } else {
          setTransientStatus({ kind: "error", text: describeTurnError(err) });
        }
      } finally {
        clearTimeout(timeout);
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, dismissHighlight, flush, bodyRef, noteId, onBodyChanged, onRevert, onStorageError, setTransientStatus, showHighlight],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { busy, status, disabledReason, submit, cancel, clearStatus, highlight, dismissHighlight };
}
