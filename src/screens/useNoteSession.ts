import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { NoteStoreError } from "../agent";
import { readNote, writeNote } from "../notes/noteRepository";
import { SnapshotUndoStack } from "../notes/undoStack";

const SAVE_DEBOUNCE_MS = 500;

export type NoteSession = {
  body: string;
  /** A live snapshot of the body, safe to read from callbacks that shouldn't re-bind on every keystroke. */
  bodyRef: React.RefObject<string>;
  /** Records a user edit and schedules a debounced save. */
  edit: (next: string) => void;
  /** Adopts a body the agent already persisted, as a single undo entry for the whole turn. */
  adoptAgentResult: (next: string) => void;
  /** Puts the pre-turn body back after an aborted turn, leaving no undo entry behind. */
  revertAgentResult: (previous: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Writes any pending debounced edit immediately. */
  flush: () => void;
  /**
   * A storage failure that the user needs to see. Never auto-dismissed: an
   * unsaved note that looks saved is the worst outcome in the app
   * (PRD §14 error matrix), so this stays on screen until it succeeds or the
   * user acknowledges it.
   */
  storageError: string | null;
  retrySave: () => void;
  dismissStorageError: () => void;
  /** Lets a storage failure raised elsewhere (an agent turn's own write) surface in the same banner. */
  reportStorageError: (message: string) => void;
  /** True when the note could not be read at all, so writes are blocked to avoid overwriting it with nothing. */
  loadFailed: boolean;
};

function describeStorageError(err: unknown): string {
  if (err instanceof NoteStoreError) return err.message;
  return err instanceof Error ? err.message : "Storage is unavailable.";
}

function loadInitialBody(noteId: string): { body: string; error: string | null } {
  try {
    return { body: readNote(noteId), error: null };
  } catch (err) {
    return { body: "", error: describeStorageError(err) };
  }
}

/**
 * Owns one note's in-memory body and its relationship to disk: debounced saves,
 * lifecycle flushing, undo/redo, and surfacing storage failures. Pulled out of
 * NoteEditorScreen so the screen renders and this decides what persists.
 */
export function useNoteSession(noteId: string): NoteSession {
  const [initial] = useState(() => loadInitialBody(noteId));
  const [body, setBody] = useState(initial.body);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(initial.error);

  const loadFailed = initial.error !== null;
  const bodyRef = useRef(initial.body);
  const undoStackRef = useRef(new SnapshotUndoStack(initial.body));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The value a failed write was trying to persist, kept so Retry has something to retry. */
  const unsavedRef = useRef<string | null>(null);

  const syncUndoFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.canUndo());
    setCanRedo(undoStackRef.current.canRedo());
  }, []);

  /** The single place anything reaches disk, so every write path reports failures the same way. */
  const persist = useCallback(
    (next: string) => {
      if (loadFailed) return;
      try {
        writeNote(noteId, next);
        unsavedRef.current = null;
        setStorageError(null);
      } catch (err) {
        unsavedRef.current = next;
        setStorageError(describeStorageError(err));
      }
    },
    [noteId, loadFailed],
  );

  const commit = useCallback(
    (next: string) => {
      undoStackRef.current.push(next);
      syncUndoFlags();
      persist(next);
    },
    [persist, syncUndoFlags],
  );

  const cancelPendingSave = useCallback(() => {
    if (!saveTimer.current) return false;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    return true;
  }, []);

  const flush = useCallback(() => {
    if (cancelPendingSave()) commit(bodyRef.current);
  }, [cancelPendingSave, commit]);

  const edit = useCallback(
    (next: string) => {
      setBody(next);
      bodyRef.current = next;
      cancelPendingSave();
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        commit(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [cancelPendingSave, commit],
  );

  const adoptAgentResult = useCallback(
    (next: string) => {
      // The agent wrote through its own NoteStore, so this only reconciles the
      // UI and records one undo entry for the whole turn.
      setBody(next);
      bodyRef.current = next;
      undoStackRef.current.push(next);
      syncUndoFlags();
    },
    [syncUndoFlags],
  );

  const revertAgentResult = useCallback(
    (previous: string) => {
      // A cancelled turn should leave no trace. The agent writes through its own
      // NoteStore, so a partial edit may already be on disk even though nothing
      // was ever adopted into the UI — this puts the pre-turn body back.
      //
      // The undo stack is deliberately untouched: nothing was pushed, so there
      // is nothing to undo, and "Cancelled" means the note is as it was.
      cancelPendingSave();
      setBody(previous);
      bodyRef.current = previous;
      persist(previous);
    },
    [cancelPendingSave, persist],
  );

  const applyHistory = useCallback(
    (restored: string) => {
      cancelPendingSave();
      setBody(restored);
      bodyRef.current = restored;
      syncUndoFlags();
      persist(restored);
    },
    [cancelPendingSave, persist, syncUndoFlags],
  );

  const undo = useCallback(() => applyHistory(undoStackRef.current.undo()), [applyHistory]);
  const redo = useCallback(() => applyHistory(undoStackRef.current.redo()), [applyHistory]);

  const retrySave = useCallback(() => {
    persist(unsavedRef.current ?? bodyRef.current);
  }, [persist]);

  const dismissStorageError = useCallback(() => setStorageError(null), []);

  const reportStorageError = useCallback((message: string) => setStorageError(message), []);

  // Backgrounding and unmount are the two moments a debounced edit would
  // otherwise be lost.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);

  return {
    body,
    bodyRef,
    edit,
    adoptAgentResult,
    revertAgentResult,
    canUndo,
    canRedo,
    undo,
    redo,
    flush,
    storageError,
    retrySave,
    dismissStorageError,
    reportStorageError,
    loadFailed,
  };
}
