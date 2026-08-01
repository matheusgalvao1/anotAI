import { compact } from "./compaction";
import { AGENT_CONFIG } from "./config";
import { NoteStore, NoteStoreError } from "./noteStore";
import { buildSystemPrompt } from "./systemPrompt";
import { estimateTokens } from "./tokens";
import {
  executePatchNote,
  executeReadNote,
  executeRewriteNote,
  PATCH_NOTE_SCHEMA,
  READ_NOTE_SCHEMA,
  REWRITE_NOTE_SCHEMA,
} from "./tools";
import { CanonicalMessage, Provider, ProviderError, ToolCall, ToolSchema } from "./types";

export class AgentProviderError extends Error {
  readonly providerError: ProviderError;
  constructor(providerError: ProviderError) {
    super(providerError.message);
    this.name = "AgentProviderError";
    this.providerError = providerError;
  }
}

export type StoppedReason = "completed" | "max_iterations" | "cancelled" | "timed_out";

/**
 * Pass this as the abort reason (`controller.abort(TURN_TIMEOUT)`) when a turn
 * is being cut off by a deadline rather than by the user. Both arrive as an
 * `AbortError`, and reporting a 2-minute timeout as "Cancelled" tells the user
 * they did something they didn't.
 */
export const TURN_TIMEOUT = "anotai:turn-timeout";

export type TurnResult = {
  finalText: string;
  bodyChanged: boolean;
  newBody: string;
  stoppedReason: StoppedReason;
  toolCallsExecuted: number;
  updatedHistory: CanonicalMessage[];
};

export type RunTurnParams = {
  prompt: string;
  noteTitle: string;
  store: NoteStore;
  /** Prior messages for this note session (excludes the system prompt, which is rebuilt every request). Empty for a fresh session. */
  history: CanonicalMessage[];
  provider: Provider;
  signal?: AbortSignal;
  /**
   * Called after each tool call that actually changed the note, with the body
   * either side of that single write. Lets the UI highlight and scroll to each
   * change as it lands rather than only once at the end of the turn (PRD §7.5).
   *
   * A plain callback, not an event emitter: the core stays framework-free, and
   * the caller decides what a change means. Never called for a tool that left
   * the note untouched.
   */
  onNoteWritten?: (before: string, after: string) => void;
};

/** The tools that can change the note, so the others are never read back around. */
const WRITE_TOOLS = new Set(["rewrite_note", "patch_note"]);

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function selectTools(noteTokenCount: number): ToolSchema[] {
  const tools = [READ_NOTE_SCHEMA, REWRITE_NOTE_SCHEMA];
  if (noteTokenCount >= AGENT_CONFIG.FORCE_REWRITE_BELOW_TOKENS) {
    tools.push(PATCH_NOTE_SCHEMA);
  }
  return tools;
}

/**
 * Dispatches one tool call. Arguments are untrusted model output, so each
 * executor validates its own input and returns a tool error rather than
 * throwing — a bad argument becomes something the model can correct on the next
 * iteration instead of aborting the user's turn.
 *
 * Storage failures and cancellation are the two exceptions: both rethrow, since
 * neither is something the model can fix by trying again.
 */
function executeTool(call: ToolCall, store: NoteStore): unknown {
  try {
    switch (call.name) {
      case "read_note":
        return executeReadNote(store, call.arguments);
      case "rewrite_note":
        return executeRewriteNote(store, call.arguments);
      case "patch_note":
        return executePatchNote(store, call.arguments);
      default:
        return { ok: false, error: `Unknown tool: ${call.name}` };
    }
  } catch (err) {
    if (err instanceof NoteStoreError || isAbortError(err)) throw err;
    return { ok: false, error: err instanceof Error ? err.message : "The tool failed unexpectedly." };
  }
}

/**
 * Runs one agent turn to completion: builds the system prompt from live note
 * state each iteration, streams from the provider, executes any tool calls
 * locally, and repeats until the model replies with plain text or a guard
 * trips (PRD §6.6). The editor is expected to be soft-locked by the caller
 * for the duration of this call.
 */
export async function runTurn(params: RunTurnParams): Promise<TurnResult> {
  const { prompt, noteTitle, store, provider } = params;
  const signal = params.signal ?? new AbortController().signal;

  let messages: CanonicalMessage[] = [...params.history, { role: "user", content: prompt }];
  const snapshot = store.read();

  let finalText = "";
  let stoppedReason: StoppedReason = "completed";
  let toolCallsExecuted = 0;

  for (let iteration = 0; iteration < AGENT_CONFIG.MAX_ITERATIONS; iteration++) {
    if (estimateTokens(JSON.stringify(messages)) > AGENT_CONFIG.COMPACT_THRESHOLD_TOKENS) {
      messages = await compact(messages, provider);
    }

    const currentBody = store.read();
    const system = buildSystemPrompt({ title: noteTitle, body: currentBody });
    const tools = selectTools(estimateTokens(currentBody));

    let assistantText = "";
    const toolCalls: ToolCall[] = [];
    let sawError: ProviderError | null = null;

    try {
      for await (const event of provider.send({ system, messages, tools, signal })) {
        if (event.type === "text") assistantText += event.delta;
        else if (event.type === "toolCall") toolCalls.push(event.call);
        else if (event.type === "error") sawError = event.error;
      }
    } catch (err) {
      if (isAbortError(err)) return abortResult();
      throw err;
    }

    // An abort surfaces either as a thrown AbortError (mid-stream) or as an
    // error event (if it lands while the request is still being opened). Both
    // are the same user-visible situation, so they must report identically —
    // checking the signal here is what keeps them from diverging.
    if (sawError) {
      if (signal.aborted) return abortResult();
      throw new AgentProviderError(sawError);
    }

    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content: assistantText });
      finalText = assistantText;
      stoppedReason = "completed";
      return buildResult();
    }

    messages.push({ role: "assistant", toolCalls });
    for (const call of toolCalls) {
      // Only read back around tools that can write, and only when someone is
      // listening — read_note can't change anything, so comparing before and
      // after it would be two wasted filesystem reads per call.
      const watching = params.onNoteWritten !== undefined && WRITE_TOOLS.has(call.name);
      const before = watching ? store.read() : null;

      const result = executeTool(call, store);
      toolCallsExecuted++;

      if (before !== null) {
        const after = store.read();
        if (after !== before) params.onNoteWritten?.(before, after);
      }

      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }

    if (iteration === AGENT_CONFIG.MAX_ITERATIONS - 1) {
      stoppedReason = "max_iterations";
      finalText = "Stopped after 8 steps.";
    }
  }

  return buildResult();

  /** Shared exit for both abort paths, so a timeout is never reported as a cancellation. */
  function abortResult(): TurnResult {
    const timedOut = signal.reason === TURN_TIMEOUT;
    stoppedReason = timedOut ? "timed_out" : "cancelled";
    finalText = timedOut ? "Timed out" : "Cancelled";
    // An aborted turn is discarded, not recorded. The caller reverts the note to
    // its pre-turn body (see `useAgentTurn`), so keeping the prompt and whatever
    // partial output arrived would leave the history describing edits that no
    // longer exist — and the next turn would ask the model to build on them.
    //
    // It also matters to the wire format: a turn aborted before the model
    // replied leaves history ending on a `user` message, so the next turn
    // appends a second one. OpenAI-shaped APIs tolerate that; Anthropic rejects
    // consecutive same-role messages outright.
    return { ...buildResult(), updatedHistory: params.history };
  }

  function buildResult(): TurnResult {
    const newBody = store.read();
    return {
      finalText: finalText || "Done",
      bodyChanged: newBody !== snapshot,
      newBody,
      stoppedReason,
      toolCallsExecuted,
      updatedHistory: messages,
    };
  }
}
