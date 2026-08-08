import 'dart:convert';

import '../../../models/ai_allow_list.dart';
import '../reasoning.dart';
import '../transport.dart';
import '../types.dart';

const _anthropicUrl = 'https://api.anthropic.com/v1/messages';
const _anthropicVersion = '2023-06-01';
const _maxTokens = 8192;

/// Anthropic's Messages API. A genuinely different protocol from OpenAI's:
/// the system prompt is a top-level field, tool calls/results are content
/// blocks (`tool_use` / `tool_result`) inside assistant/user messages, tool
/// schemas use `input_schema`, and streaming is named events with `partial_json`
/// fragments accumulated per block index. Auth is `x-api-key`, not a bearer.
class AnthropicProvider implements Provider {
  AnthropicProvider({
    required this.apiKey,
    required this.model,
    required this.reasoning,
    HttpTransport? transport,
    String displayName = 'Anthropic',
  })  : _transport = transport ?? HttpTransportImpl(),
        _displayName = displayName;

  final String apiKey;
  final String model;
  final ReasoningMode reasoning;
  final HttpTransport _transport;
  final String _displayName;

  @override
  Stream<ProviderStreamEvent> send(ProviderRequest request) async* {
    final body = {
      'model': model,
      'max_tokens': _maxTokens,
      'stream': true,
      'system': request.system,
      'messages': _toAnthropicMessages(request.messages),
      if (request.tools.isNotEmpty)
        'tools': request.tools.map(_toAnthropicTool).toList(growable: false),
      ..._thinking(),
    };

    HttpResponseLike opened;
    try {
      opened = await _transport.post(
        Uri.parse(_anthropicUrl),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': _anthropicVersion,
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
      yield* _parseAnthropicStream(stream, request.cancellation);
    } catch (err) {
      yield ProviderErrorMessage(toTransportError(err, request.cancellation));
    }
  }

  Map<String, dynamic> _thinking() {
    switch (reasoning) {
      case ReasoningMode.disabled:
        return {
          'thinking': {'type': 'disabled'}
        };
      case ReasoningMode.enabled:
        return {
          'thinking': {'type': 'enabled', 'budget_tokens': 4096}
        };
      default:
        final effort = effortValue(reasoning)!;
        // Claude 5 models are adaptive-only (budget ignored) and take the
        // effort level via output_config.effort; budget_tokens is kept for
        // older budget-based models where it is the only knob.
        return {
          'thinking': {'type': 'enabled', 'budget_tokens': 8192},
          'output_config': {'effort': effort},
        };
    }
  }
}

class _ToolBlock {
  _ToolBlock({required this.id, required this.name});
  final String id;
  final String name;
  String json = '';
}

Stream<ProviderStreamEvent> _parseAnthropicStream(
    Stream<List<int>> stream, CancellationToken token) async* {
  final blocks = <int, _ToolBlock>{};

  await for (final event in readSseEvents(stream, token: token)) {
    if (event.data.isEmpty) continue;
    Object? parsed;
    try {
      parsed = jsonDecode(event.data);
    } catch (_) {
      continue;
    }
    if (parsed is! Map<String, dynamic>) continue;

    switch (parsed['type']) {
      case 'content_block_start':
        final block = parsed['content_block'];
        if (block is Map<String, dynamic> && block['type'] == 'tool_use') {
          final id = block['id'];
          final name = block['name'];
          final index = parsed['index'];
          if (id is String && name is String) {
            blocks[index is num ? index.toInt() : 0] =
                _ToolBlock(id: id, name: name);
          }
        }

      case 'content_block_delta':
        final delta = parsed['delta'];
        if (delta is! Map<String, dynamic>) continue;
        final text = delta['text'];
        if (delta['type'] == 'text_delta' &&
            text is String &&
            text.isNotEmpty) {
          yield TextDelta(text);
        }
        final partialJson = delta['partial_json'];
        if (delta['type'] == 'input_json_delta' && partialJson is String) {
          final index = parsed['index'];
          final block = blocks[index is num ? index.toInt() : 0];
          if (block != null) block.json += partialJson;
        }

      case 'content_block_stop':
        final index = parsed['index'];
        final block = blocks.remove(index is num ? index.toInt() : 0);
        if (block != null) yield ToolCallEvent(_finishToolBlock(block));

      case 'message_delta':
      case 'message_start':
        final usage = parsed['usage'] ?? parsed['message'];
        if (usage is Map<String, dynamic>) {
          final report = usageEvent(
            usage['input_tokens'] is num
                ? (usage['input_tokens'] as num).toInt()
                : null,
            usage['output_tokens'] is num
                ? (usage['output_tokens'] as num).toInt()
                : null,
          );
          if (report != null) yield report;
        }

      case 'error':
        final error = parsed['error'];
        final message =
            error is Map<String, dynamic> && error['message'] is String
                ? error['message'] as String
                : 'Anthropic reported an error.';
        yield ProviderErrorMessage(
            ProviderError(kind: ProviderErrorKind.unknown, message: message));
    }
  }

  // A stream that ended without content_block_stop still holds complete calls.
  for (final block in blocks.values) {
    yield ToolCallEvent(_finishToolBlock(block));
  }
}

ToolCall _finishToolBlock(_ToolBlock block) {
  return ToolCall(
    id: block.id,
    name: block.name,
    arguments: _parseArguments(block.json),
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

/// Anthropic rejects two messages with the same role in a row, so blocks are
/// merged into the previous message when the role matches. A `tool` result
/// rides inside a **user** message as a `tool_result` block.
List<Map<String, dynamic>> _toAnthropicMessages(
    List<CanonicalMessage> messages) {
  final out = <Map<String, dynamic>>[];

  void appendBlock(String role, Object block) {
    final last = out.isEmpty ? null : out.last;
    if (last != null && last['role'] == role && last['content'] is List) {
      (last['content'] as List).add(block);
    } else {
      out.add({
        'role': role,
        'content': [block]
      });
    }
  }

  for (final message in messages) {
    switch (message) {
      case ToolResultMessage(:final toolCallId, :final content):
        appendBlock('user', {
          'type': 'tool_result',
          'tool_use_id': toolCallId,
          'content': content
        });

      case AssistantToolCalls(:final toolCalls):
        for (final call in toolCalls) {
          appendBlock('assistant', {
            'type': 'tool_use',
            'id': call.id,
            'name': call.name,
            'input': call.arguments
          });
        }

      case UserMessage(:final content):
        appendBlock('user', {'type': 'text', 'text': content});
      case AssistantMessage(:final content):
        appendBlock('assistant', {'type': 'text', 'text': content});
    }
  }

  return out;
}

/// `input_schema`, not `parameters`, and not nested under a `function` key.
Map<String, dynamic> _toAnthropicTool(ToolSchema tool) => {
      'name': tool.name,
      'description': tool.description,
      'input_schema': tool.parameters,
    };
