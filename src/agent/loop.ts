import { compact } from "./compaction";
import { AGENT_CONFIG } from "./config";
import { NoteStore } from "./noteStore";
import { buildSystemPrompt } from "./systemPrompt";
import { estimateTokens } from "./tokens";
import {
  executePatchNote,
  executeReadNote,
  executeRewriteNote,
  PATCH_NOTE_SCHEMA,
  PatchNoteArgs,
  READ_NOTE_SCHEMA,
  ReadNoteArgs,
  RewriteNoteArgs,
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

export type StoppedReason = "completed" | "max_iterations" | "cancelled";

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
};

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

function executeTool(call: ToolCall, store: NoteStore): unknown {
  switch (call.name) {
    case "read_note":
      return executeReadNote(store, call.arguments as unknown as ReadNoteArgs);
    case "rewrite_note":
      return executeRewriteNote(store, call.arguments as unknown as RewriteNoteArgs);
    case "patch_note":
      return executePatchNote(store, call.arguments as unknown as PatchNoteArgs);
    default:
      return { ok: false, error: `Unknown tool: ${call.name}` };
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
      if (isAbortError(err)) {
        stoppedReason = "cancelled";
        finalText = "Cancelled";
        return buildResult();
      }
      throw err;
    }

    if (sawError) throw new AgentProviderError(sawError);

    if (toolCalls.length === 0) {
      messages.push({ role: "assistant", content: assistantText });
      finalText = assistantText;
      stoppedReason = "completed";
      return buildResult();
    }

    messages.push({ role: "assistant", toolCalls });
    for (const call of toolCalls) {
      const result = executeTool(call, store);
      toolCallsExecuted++;
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }

    if (iteration === AGENT_CONFIG.MAX_ITERATIONS - 1) {
      stoppedReason = "max_iterations";
      finalText = "Stopped after 8 steps.";
    }
  }

  return buildResult();

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
