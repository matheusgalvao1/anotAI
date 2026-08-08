import 'dart:convert';

import '../../../models/ai_allow_list.dart';
import '../reasoning.dart';
import '../transport.dart';
import '../types.dart';

const _openaiResponsesUrl = 'https://api.openai.com/v1/responses';

/// OpenAI's Responses API — **not** chat-completions.
///
/// Some OpenAI models reject function tools on `/v1/chat/completions` (the
/// `gpt-5.6` family among them requires path-dependent reasoning), while they
/// all accept tools on `/v1/responses`, so this adapter speaks only that and
/// the question disappears rather than being managed.
///
/// `store: false` is deliberate: the API otherwise retains the conversation
/// server-side, and this app has no backend and no telemetry by design. The
/// cost of opting out is that reasoning state must travel in the request,
/// which is what the replayed `reasoning` items are for.
class OpenAiProvider implements Provider {
  OpenAiProvider({
    required this.apiKey,
    required this.model,
    required this.reasoning,
    HttpTransport? transport,
    String displayName = 'OpenAI',
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
      'stream': true,
      'store': false,
      'instructions': request.system,
      'input': _toResponsesInput(request.messages),
      if (request.tools.isNotEmpty)
        'tools': request.tools.map(_toResponsesTool).toList(growable: false),
      // Without this the reasoning items come back with an empty
      // `encrypted_content` and cannot be replayed. Harmless for models that
      // do no reasoning — they simply emit no reasoning items.
      'include': ['reasoning.encrypted_content'],
      ..._reasoningBody(),
    };

    HttpResponseLike opened;
    try {
      opened = await _transport.post(
        Uri.parse(_openaiResponsesUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $apiKey',
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
      yield* _parseResponsesStream(stream, request.cancellation, _displayName);
    } catch (err) {
      yield ProviderErrorMessage(toTransportError(err, request.cancellation));
    }
  }

  Map<String, dynamic> _reasoningBody() {
    final effort = effortValue(reasoning) ?? 'medium';
    return {
      'reasoning': {'effort': effort}
    };
  }
}

class _PendingCall {
  _PendingCall({required this.callId, required this.name, required this.args});
  final String callId;
  final String name;
  String args;
}

Stream<ProviderStreamEvent> _parseResponsesStream(
  Stream<List<int>> stream,
  CancellationToken token,
  String displayName,
) async* {
  final pending = <int, _PendingCall>{};
  final reasoning = <Object?>[];

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
      case 'response.output_text.delta':
        final delta = parsed['delta'];
        if (delta is String && delta.isNotEmpty) yield TextDelta(delta);

      case 'response.output_item.added':
        final item = parsed['item'];
        if (item is Map<String, dynamic> && item['type'] == 'function_call') {
          final name = item['name'];
          final index = parsed['output_index'];
          pending[index is num ? index.toInt() : 0] = _PendingCall(
            callId: item['call_id'] is String ? item['call_id'] as String : '',
            name: name is String ? name : '',
            args:
                item['arguments'] is String ? item['arguments'] as String : '',
          );
        }

      case 'response.function_call_arguments.delta':
        final index = parsed['output_index'];
        final delta = parsed['delta'];
        final call = pending[index is num ? index.toInt() : 0];
        if (call != null && delta is String) call.args += delta;

      case 'response.output_item.done':
        final index = parsed['output_index'];
        final item = parsed['item'];
        if (item is! Map<String, dynamic>) continue;

        if (item['type'] == 'reasoning') {
          // Kept verbatim rather than rebuilt: it is opaque, and the API is
          // the only thing that knows what it must contain to be accepted back.
          reasoning.add(item);
          continue;
        }

        if (item['type'] == 'function_call') {
          final name = item['name'];
          if (name is String) {
            pending.remove(index is num ? index.toInt() : 0);
            final callId =
                item['call_id'] is String ? item['call_id'] as String : '';
            final args =
                item['arguments'] is String ? item['arguments'] as String : '';
            yield ToolCallEvent(ToolCall(
              id: callId,
              name: name,
              arguments: _parseArguments(args),
              providerData: reasoning.isEmpty
                  ? null
                  : {
                      'reasoning': [...reasoning]
                    },
            ));
          }
        }

      case 'response.completed':
        final response = parsed['response'];
        if (response is Map<String, dynamic>) {
          final usage = response['usage'];
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
        }

      case 'error':
      case 'response.failed':
        final body = parsed['message'] ?? parsed['response'];
        final message =
            body is Map<String, dynamic> && body['message'] is String
                ? body['message'] as String
                : null;
        yield ProviderErrorMessage(ProviderError(
          kind: ProviderErrorKind.unknown,
          message: message ?? '$displayName reported an error.',
        ));
    }
  }

  // A stream that ended before output_item.done still holds real calls.
  for (final call in pending.values) {
    if (call.name.isNotEmpty) {
      yield ToolCallEvent(ToolCall(
        id: call.callId,
        name: call.name,
        arguments: _parseArguments(call.args),
        providerData: reasoning.isEmpty
            ? null
            : {
                'reasoning': [...reasoning]
              },
      ));
    }
  }
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

/// Canonical messages → Responses `input` items.
///
/// A tool call and its result are top-level items here, not a field on an
/// assistant message and a `tool` role.
List<Object?> _toResponsesInput(List<CanonicalMessage> messages) {
  final out = <Object?>[];
  final emittedReasoning = <String>{};

  for (final message in messages) {
    switch (message) {
      case ToolResultMessage(:final toolCallId, :final content):
        out.add({
          'type': 'function_call_output',
          'call_id': toolCallId,
          'output': content
        });

      case AssistantToolCalls(:final toolCalls):
        for (final call in toolCalls) {
          final data = call.providerData;
          final reasoningItems =
              data is Map<String, dynamic> ? data['reasoning'] : null;
          if (reasoningItems is List) {
            for (final item in reasoningItems) {
              final id = item is Map<String, dynamic> ? item['id'] : null;
              if (id is String && emittedReasoning.contains(id)) continue;
              if (id is String) emittedReasoning.add(id);
              out.add(item);
            }
          }
        }
        for (final call in toolCalls) {
          out.add({
            'type': 'function_call',
            'call_id': call.id,
            'name': call.name,
            'arguments': jsonEncode(call.arguments),
          });
        }

      case UserMessage(:final content):
        out.add({'role': 'user', 'content': content});
      case AssistantMessage(:final content):
        out.add({'role': 'assistant', 'content': content});
    }
  }

  return out;
}

/// Flat, unlike chat-completions' `{type:"function", function:{…}}` nesting.
Map<String, dynamic> _toResponsesTool(ToolSchema tool) => {
      'type': 'function',
      'name': tool.name,
      'description': tool.description,
      'parameters': tool.parameters,
    };
