import 'dart:async';
import 'dart:convert';

import 'compaction.dart';
import 'config.dart';
import 'note_store.dart';
import 'system_prompt.dart';
import 'tokens.dart';
import 'tools.dart';
import 'types.dart';

/// A provider failure that should surface to the UI (auth, rate limit, model
/// missing, tool support rejection, …) rather than be treated as a bug.
class AgentProviderError implements Exception {
  const AgentProviderError(this.providerError);
  final ProviderError providerError;

  @override
  String toString() => providerError.message;
}

enum StoppedReason { completed, maxIterations, cancelled, timedOut }

/// Pass this as the cancellation token reason when a turn is being cut off by a
/// deadline rather than by the user. Both arrive as a cancellation, and
/// reporting a 2-minute timeout as "Cancelled" would tell the user they did
/// something they didn't.
const turnTimeoutReason = 'anotai:turn-timeout';

class TurnResult {
  const TurnResult({
    required this.finalText,
    required this.bodyChanged,
    required this.newBody,
    required this.stoppedReason,
    required this.toolCallsExecuted,
    required this.updatedHistory,
  });

  final String finalText;
  final bool bodyChanged;
  final String newBody;
  final StoppedReason stoppedReason;
  final int toolCallsExecuted;
  final List<CanonicalMessage> updatedHistory;
}

class RunTurnParams {
  const RunTurnParams({
    required this.prompt,
    required this.noteTitle,
    required this.store,
    required this.history,
    required this.provider,
    this.cancellation,
    this.onNoteWritten,
  });

  final String prompt;
  final String noteTitle;
  final NoteStore store;

  /// Prior messages for this note session (the system prompt is rebuilt every
  /// request). Empty for a fresh session.
  final List<CanonicalMessage> history;

  final Provider provider;
  final CancellationToken? cancellation;

  /// Called after each tool call that actually changed the note, with the body
  /// either side of that single write, so the UI can highlight and scroll to
  /// each change as it lands. Never called for a tool that left the note
  /// untouched.
  final void Function(String before, String after)? onNoteWritten;
}

List<ToolSchema> _selectTools(int noteTokens) {
  final tools = [readNoteSchema, rewriteNoteSchema];
  if (noteTokens >= AgentConfig.forceRewriteBelowTokens) {
    tools.add(patchNoteSchema);
  }
  return tools;
}

/// Dispatches one tool call. Arguments are untrusted model output, so each
/// executor validates its own input and returns a tool error rather than
/// throwing — a bad argument becomes something the model can correct on the
/// next iteration instead of aborting the user's turn. Storage failures and
/// cancellation are the two exceptions, rethrown since neither is something
/// the model can fix by trying again.
Object _executeTool(ToolCall call, NoteStore store) {
  try {
    switch (call.name) {
      case 'read_note':
        return executeReadNote(store, call.arguments);
      case 'rewrite_note':
        return executeRewriteNote(store, call.arguments);
      case 'patch_note':
        return executePatchNote(store, call.arguments);
      default:
        return {'ok': false, 'error': 'Unknown tool: ${call.name}'};
    }
  } on NoteStoreError {
    rethrow;
  } on CancelledException {
    rethrow;
  } catch (err) {
    return {'ok': false, 'error': err.toString()};
  }
}

String _dumpMessages(List<CanonicalMessage> messages) {
  final buffer = StringBuffer();
  for (final message in messages) {
    switch (message) {
      case UserMessage(:final content):
        buffer.write(content);
      case AssistantMessage(:final content):
        buffer.write(content);
      case AssistantToolCalls(:final toolCalls):
        buffer.write(jsonEncode([
          for (final call in toolCalls)
            {'name': call.name, 'arguments': call.arguments},
        ]));
      case ToolResultMessage(:final content):
        buffer.write(content);
    }
    buffer.write('\n');
  }
  return buffer.toString();
}

/// Runs one agent turn to completion: builds the system prompt from live note
/// state each iteration, streams from the provider, executes any tool calls
/// locally, and repeats until the model replies with plain text or a guard
/// trips. The editor is expected to be soft-locked by the caller for the
/// duration of this call.
Future<TurnResult> runTurn(RunTurnParams params) async {
  final signal = params.cancellation ?? CancellationToken.none();
  var messages = <CanonicalMessage>[
    ...params.history,
    UserMessage(params.prompt)
  ];
  final snapshot = params.store.read();

  var finalText = '';
  var stoppedReason = StoppedReason.completed;
  var toolCallsExecuted = 0;

  // Shared exits, declared before the loop so both call sites stay in reach.
  TurnResult buildResult({List<CanonicalMessage>? updatedHistory}) {
    final newBody = params.store.read();
    return TurnResult(
      finalText: finalText.isEmpty ? 'Done' : finalText,
      bodyChanged: newBody != snapshot,
      newBody: newBody,
      stoppedReason: stoppedReason,
      toolCallsExecuted: toolCallsExecuted,
      updatedHistory: updatedHistory ?? messages,
    );
  }

  TurnResult abortResult() {
    final timedOut = signal.reason == turnTimeoutReason;
    stoppedReason = timedOut ? StoppedReason.timedOut : StoppedReason.cancelled;
    finalText = timedOut ? 'Timed out' : 'Cancelled';
    // An aborted turn is discarded, not recorded. The caller reverts the note
    // to its pre-turn body, so keeping the prompt and whatever partial output
    // arrived would leave history describing edits that no longer exist — and
    // the next turn would ask the model to build on them. It also matters to
    // the wire format: a turn aborted before the model replied leaves history
    // ending on a `user` message, so the next turn appends a second one, which
    // Anthropic rejects outright.
    return buildResult(updatedHistory: params.history);
  }

  for (var iteration = 0; iteration < AgentConfig.maxIterations; iteration++) {
    if (estimateTokens(_dumpMessages(messages)) >
        AgentConfig.compactThresholdTokens) {
      messages = await compact(messages, params.provider);
    }

    final currentBody = params.store.read();
    final system =
        buildSystemPrompt(title: params.noteTitle, body: currentBody);
    final tools = _selectTools(estimateTokens(currentBody));

    var assistantText = '';
    final toolCalls = <ToolCall>[];
    ProviderError? sawError;

    try {
      await for (final event in params.provider.send(
        ProviderRequest(
          system: system,
          messages: messages,
          tools: tools,
          cancellation: signal,
        ),
      )) {
        switch (event) {
          case TextDelta(:final delta):
            assistantText += delta;
          case ToolCallEvent(:final call):
            toolCalls.add(call);
          case ProviderErrorMessage(:final error):
            sawError = error;
          case UsageEvent():
            break;
        }
      }
    } on CancelledException {
      return abortResult();
    }

    if (sawError != null) {
      if (signal.isCancelled) return abortResult();
      throw AgentProviderError(sawError);
    }

    if (toolCalls.isEmpty) {
      messages.add(AssistantMessage(assistantText));
      finalText = assistantText;
      stoppedReason = StoppedReason.completed;
      return buildResult();
    }

    messages.add(AssistantToolCalls(toolCalls));
    for (final call in toolCalls) {
      // Only read back around tools that can write, and only when someone is
      // listening — read_note can't change anything.
      final watching =
          params.onNoteWritten != null && writeToolNames.contains(call.name);
      final before = watching ? params.store.read() : null;

      final result = _executeTool(call, params.store);
      toolCallsExecuted++;

      if (before != null) {
        final after = params.store.read();
        if (after != before) params.onNoteWritten!(before, after);
      }

      messages.add(
          ToolResultMessage(toolCallId: call.id, content: jsonEncode(result)));
    }

    if (iteration == AgentConfig.maxIterations - 1) {
      stoppedReason = StoppedReason.maxIterations;
      finalText = 'Stopped after ${AgentConfig.maxIterations} steps.';
    }
  }

  return buildResult();
}
