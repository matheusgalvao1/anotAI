import 'dart:async';

import 'config.dart';
import 'types.dart';

const _compactionSystemPrompt =
    "Summarize this editing session in a few sentences: what the user has asked for so far, and what has already been changed. Write for the agent that will continue this session, not for the user. Do not include the note's content — it will be provided fresh. Be concise.";

/// Collapses prior turns into a short summary once the context grows past the
/// compaction threshold. Compaction failure must never fail the user's turn,
/// so a summarization error falls back to dropping the oldest messages.
Future<List<CanonicalMessage>> compact(
  List<CanonicalMessage> messages,
  Provider provider,
) async {
  try {
    final summary = await _summarize(messages, provider);
    return [UserMessage('[Prior session context, summarized]\n$summary')];
  } catch (_) {
    return _dropOldest(messages);
  }
}

Future<String> _summarize(
    List<CanonicalMessage> messages, Provider provider) async {
  final token = CancellationToken();
  final timer = Timer(AgentConfig.requestTimeout, token.cancel);
  try {
    var text = '';
    await for (final event in provider.send(ProviderRequest(
      system: _compactionSystemPrompt,
      messages: messages,
      tools: const [],
      cancellation: token,
    ))) {
      if (event is TextDelta) text += event.delta;
      if (event is ProviderErrorMessage) {
        throw StateError(event.error.message);
      }
    }
    if (text.trim().isEmpty) {
      throw StateError('compaction produced an empty summary');
    }
    return text.trim();
  } finally {
    timer.cancel();
  }
}

/// Groups messages so a tool-call round trip stays indivisible: an assistant
/// message carrying tool calls travels with the `tool` results that answer it.
/// Dropping one without the other produces a message list that OpenAI-shaped
/// APIs reject outright.
List<List<CanonicalMessage>> _groupMessages(List<CanonicalMessage> messages) {
  final groups = <List<CanonicalMessage>>[];

  for (final message in messages) {
    final isToolResult = message is ToolResultMessage;
    final previous = groups.isEmpty ? null : groups.last;
    final previousOpensToolCalls =
        previous != null && previous.first is AssistantToolCalls;

    if (isToolResult && previousOpensToolCalls) {
      previous.add(message);
    } else {
      groups.add([message]);
    }
  }

  return groups;
}

/// Last-resort shrink when summarization itself fails: drops whole groups from
/// the front so the surviving list is always a valid request, and never
/// strands a `tool` result at the head of the conversation.
List<CanonicalMessage> _dropOldest(List<CanonicalMessage> messages) {
  final groups = _groupMessages(messages);
  final dropped = (messages.length - groups.length).clamp(1, 2);
  final survivors = groups.skip(dropped).expand((group) => group).toList();
  return survivors.isEmpty
      ? const [UserMessage('[Session context dropped]')]
      : survivors;
}
