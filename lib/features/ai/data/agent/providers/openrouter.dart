import 'dart:convert';

import '../../../models/ai_allow_list.dart';
import '../reasoning.dart';
import '../transport.dart';
import '../types.dart';

const _openRouterUrl = 'https://openrouter.ai/api/v1/chat/completions';

/// OpenRouter, which is an OpenAI-compatible endpoint — the shared
/// chat-completions implementation plus OpenRouter's attribution header.
class OpenRouterProvider implements Provider {
  OpenRouterProvider({
    required this.apiKey,
    required this.model,
    required this.reasoning,
    HttpTransport? transport,
    String displayName = 'OpenRouter',
    this.extraHeaders = const {},
  })  : _transport = transport ?? HttpTransportImpl(),
        _displayName = displayName;

  final String apiKey;
  final String model;
  final ReasoningMode reasoning;

  /// Additional headers (OpenRouter's attribution, custom endpoints).
  final Map<String, String> extraHeaders;

  final HttpTransport _transport;
  final String _displayName;

  @override
  Stream<ProviderStreamEvent> send(ProviderRequest request) async* {
    final body = {
      'model': model,
      'stream': true,
      'stream_options': {'include_usage': true},
      'messages': _toOpenAiMessages(request.system, request.messages),
      if (request.tools.isNotEmpty)
        'tools': request.tools.map(_toOpenAiTool).toList(growable: false),
      ..._reasoningBody(),
    };

    HttpResponseLike opened;
    try {
      opened = await _transport.post(
        Uri.parse(_openRouterUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $apiKey',
          ...extraHeaders,
        },
        body: jsonEncode(body),
        token: request.cancellation,
      );
    } catch (err) {
      yield ProviderErrorMessage(toTransportError(err, request.cancellation));
      return;
    }

    if (!opened.ok) {
      final raw = await opened.text();
      final message = errorMessageFromBody(
          raw, '$_displayName returned HTTP ${opened.status}.');
      yield ProviderErrorMessage(
        classifiedError(opened.status, message,
            '$_displayName returned HTTP ${opened.status}.'),
      );
      return;
    }

    final stream = opened.body;
    if (stream == null) {
      yield const ProviderErrorMessage(
        ProviderError(
            kind: ProviderErrorKind.unknown,
            message: 'The response did not stream.'),
      );
      return;
    }

    try {
      yield* _parseStream(stream, request.cancellation);
    } catch (err) {
      yield ProviderErrorMessage(toTransportError(err, request.cancellation));
    }
  }

  /// Maps the canonical reasoning mode onto OpenRouter's `reasoning` map.
  Map<String, dynamic> _reasoningBody() {
    final effort = effortValue(reasoning);
    if (reasoning == ReasoningMode.disabled) {
      return {
        'reasoning': {'enabled': false}
      };
    }
    if (reasoning == ReasoningMode.enabled) {
      return {
        'reasoning': {'enabled': true}
      };
    }
    return {
      'reasoning': {'effort': effort!}
    };
  }
}

List<Map<String, dynamic>> _toOpenAiMessages(
    String system, List<CanonicalMessage> messages) {
  final out = <Map<String, dynamic>>[
    {'role': 'system', 'content': system},
  ];
  for (final message in messages) {
    switch (message) {
      case UserMessage(:final content):
        out.add({'role': 'user', 'content': content});
      case AssistantMessage(:final content):
        out.add({'role': 'assistant', 'content': content});
      case AssistantToolCalls(:final toolCalls):
        out.add({
          'role': 'assistant',
          'content': null,
          'tool_calls': [
            for (final call in toolCalls)
              {
                'id': call.id,
                'type': 'function',
                'function': {
                  'name': call.name,
                  'arguments': jsonEncode(call.arguments),
                },
              },
          ],
        });
      case ToolResultMessage(:final toolCallId, :final content):
        out.add(
            {'role': 'tool', 'tool_call_id': toolCallId, 'content': content});
    }
  }
  return out;
}

Map<String, dynamic> _toOpenAiTool(ToolSchema tool) => {
      'type': 'function',
      'function': {
        'name': tool.name,
        'description': tool.description,
        'parameters': tool.parameters,
      },
    };

class _ToolCallBuffer {
  String id = '';
  String name = '';
  String args = '';
}

/// Parses a chat-completions SSE stream. Tool calls are assembled by `index`,
/// not arrival order — parallel calls interleave their fragments across chunks.
Stream<ProviderStreamEvent> _parseStream(
    Stream<List<int>> stream, CancellationToken token) async* {
  final buffers = <int, _ToolCallBuffer>{};

  await for (final event in readSseEvents(stream, token: token)) {
    if (event.data.isEmpty) continue;
    Object? parsed;
    try {
      parsed = jsonDecode(event.data);
    } catch (_) {
      continue; // a malformed chunk isn't worth failing the turn over
    }
    if (parsed is! Map<String, dynamic>) continue;

    final usage = parsed['usage'];
    if (usage is Map<String, dynamic>) {
      final report = usageEvent(
        usage['prompt_tokens'] is num
            ? (usage['prompt_tokens'] as num).toInt()
            : null,
        usage['completion_tokens'] is num
            ? (usage['completion_tokens'] as num).toInt()
            : null,
      );
      if (report != null) yield report;
    }

    final choices = parsed['choices'];
    if (choices is! List || choices.isEmpty) continue;
    final choice = choices.first;
    if (choice is! Map<String, dynamic>) continue;

    final delta = choice['delta'];
    if (delta is Map<String, dynamic>) {
      final content = delta['content'];
      if (content is String && content.isNotEmpty) {
        yield TextDelta(content);
      }
      final rawToolCalls = delta['tool_calls'];
      if (rawToolCalls is List) {
        for (final raw in rawToolCalls) {
          if (raw is! Map<String, dynamic>) continue;
          final index = raw['index'];
          final buffer = buffers.putIfAbsent(
            index is num ? index.toInt() : 0,
            () => _ToolCallBuffer(),
          );
          final id = raw['id'];
          if (id is String && id.isNotEmpty) buffer.id = id;
          final fn = raw['function'];
          if (fn is Map<String, dynamic>) {
            final name = fn['name'];
            if (name is String) buffer.name += name;
            final args = fn['arguments'];
            if (args is String) buffer.args += args;
          }
        }
      }
    }

    // Flush on *any* non-empty finish_reason. Providers behind OpenRouter
    // disagree about which one closes a tool call, and waiting for
    // "tool_calls" specifically dropped calls from the ones that send "stop".
    final finishReason = choice['finish_reason'];
    if (finishReason is String && finishReason.isNotEmpty) {
      for (final buffer in buffers.values) {
        if (buffer.name.isNotEmpty) {
          yield ToolCallEvent(_finishToolCall(buffer));
        }
      }
      buffers.clear();
    }
  }

  // A stream that ended without a finish_reason still holds complete calls.
  // Silently discarding them makes the agent look like it ignored the user.
  for (final buffer in buffers.values) {
    if (buffer.name.isNotEmpty) yield ToolCallEvent(_finishToolCall(buffer));
  }
}

ToolCall _finishToolCall(_ToolCallBuffer buffer) {
  // Malformed or truncated arguments become an empty object rather than a
  // dropped call, so the tool layer can return a model-facing error.
  return ToolCall(
    id: buffer.id,
    name: buffer.name,
    arguments: _parseArguments(buffer.args),
  );
}

Map<String, dynamic> _parseArguments(String raw) {
  if (raw.trim().isEmpty) return const {};
  try {
    final parsed = jsonDecode(raw);
    if (parsed is Map<String, dynamic>) return parsed;
  } catch (_) {
    // fall through
  }
  return const {};
}
