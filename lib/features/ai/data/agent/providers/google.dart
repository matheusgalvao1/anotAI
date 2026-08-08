import 'dart:convert';

import '../../../models/ai_allow_list.dart';
import '../transport.dart';
import '../types.dart';

const _googleBase = 'https://generativelanguage.googleapis.com/v1beta/models';

/// Google's Gemini API. Furthest from OpenAI's shape:
///
/// - Roles are `user` / **`model`** (not `assistant`).
/// - The system prompt is `systemInstruction`; tools are `functionDeclarations`
///   and calls/results come back as `functionCall` / `functionResponse` parts.
/// - **Function results are keyed by name**, so ids are mapped back to names on
///   the way out, and a `functionCall` part carries a `thoughtSignature` that
///   must be returned with it or the next request fails outright (carried on
///   `ToolCall.providerData`).
/// - The model name goes in the URL path; the key travels in `x-goog-api-key`
///   rather than the `?key=` query parameter, so it never lands in a logged URL.
class GoogleProvider implements Provider {
  GoogleProvider({
    required this.apiKey,
    required this.model,
    required this.reasoning,
    HttpTransport? transport,
    String displayName = 'Google',
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
      'systemInstruction': {
        'parts': [
          {'text': request.system}
        ]
      },
      'contents': _toGoogleContents(request.messages),
      if (request.tools.isNotEmpty)
        'tools': [
          {
            'functionDeclarations':
                request.tools.map(_toGoogleTool).toList(growable: false),
          },
        ],
      ..._thinkingConfig(),
    };

    // `alt=sse` is what makes this a real SSE stream; without it Gemini returns
    // a JSON array that only completes at the end.
    final url = Uri.parse(
        '$_googleBase/${Uri.encodeComponent(model)}:streamGenerateContent?alt=sse');

    HttpResponseLike opened;
    try {
      opened = await _transport.post(
        url,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
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
      yield* _parseGoogleStream(
          stream, request.cancellation, _countToolCalls(request.messages));
    } catch (err) {
      yield ProviderErrorMessage(toTransportError(err, request.cancellation));
    }
  }

  /// Gemini's thinking is budget-based. Canonical modes map onto token budgets;
  /// `disabled` zeroes the budget, which is how the API turns thinking off.
  Map<String, dynamic> _thinkingConfig() {
    final budget = switch (reasoning) {
      ReasoningMode.disabled => 0,
      ReasoningMode.low => 4096,
      ReasoningMode.medium || ReasoningMode.enabled => 8192,
      ReasoningMode.high => 16384,
      ReasoningMode.minimal => 2048,
    };
    return {
      'thinkingConfig': {'thinkingBudget': budget}
    };
  }
}

/// How many tool calls this conversation already contains, used to seed the
/// synthesised-id counter (Gemini correlates results by function name, but the
/// loop pairs them by id, and a duplicated id breaks a later provider switch).
int _countToolCalls(List<CanonicalMessage> messages) {
  var total = 0;
  for (final message in messages) {
    if (message case AssistantToolCalls(:final toolCalls)) {
      total += toolCalls.length;
    }
  }
  return total;
}

Stream<ProviderStreamEvent> _parseGoogleStream(
  Stream<List<int>> stream,
  CancellationToken token,
  int firstCallIndex,
) async* {
  var callIndex = firstCallIndex;

  await for (final event in readSseEvents(stream, token: token)) {
    if (event.data.isEmpty) continue;
    Object? parsed;
    try {
      parsed = jsonDecode(event.data);
    } catch (_) {
      continue;
    }
    if (parsed is! Map<String, dynamic>) continue;

    final usage = parsed['usageMetadata'];
    if (usage is Map<String, dynamic>) {
      final report = usageEvent(
        usage['promptTokenCount'] is num
            ? (usage['promptTokenCount'] as num).toInt()
            : null,
        usage['candidatesTokenCount'] is num
            ? (usage['candidatesTokenCount'] as num).toInt()
            : null,
      );
      if (report != null) yield report;
    }

    final candidates = parsed['candidates'];
    if (candidates is! List || candidates.isEmpty) continue;
    final content = (candidates.first as Map<String, dynamic>)['content'];
    if (content is! Map<String, dynamic>) continue;
    final parts = content['parts'];
    if (parts is! List) continue;

    for (final rawPart in parts) {
      if (rawPart is! Map<String, dynamic>) continue;
      final text = rawPart['text'];
      if (text is String && text.isNotEmpty) yield TextDelta(text);

      final call = rawPart['functionCall'];
      if (call is Map<String, dynamic>) {
        final name = call['name'];
        if (name is String && name.isNotEmpty) {
          final modelCallId = call['id'];
          final state = <String, Object?>{
            'id': modelCallId is String && modelCallId.isNotEmpty
                ? modelCallId
                : null,
            'thoughtSignature': rawPart['thoughtSignature'],
          }..removeWhere((_, value) => value == null);

          yield ToolCallEvent(ToolCall(
            // Prefer the model's own id; synthesise only when it sent none.
            // The loop needs an id to correlate the result, and the seeded
            // counter keeps a synthesised one unique across the conversation.
            id: modelCallId is String && modelCallId.isNotEmpty
                ? modelCallId
                : '$name-${callIndex++}',
            name: name,
            arguments: call['args'] is Map<String, dynamic>
                ? call['args'] as Map<String, dynamic>
                : const {},
            providerData: state.isEmpty ? null : state,
          ));
        }
      }
    }
  }
}

/// Reads the state back defensively: `providerData` is `unknown` by design,
/// history may be persisted, and may belong to another provider entirely.
({String? id, String? thoughtSignature}) _googleCallState(Object? data) {
  if (data is! Map<String, dynamic>) return (id: null, thoughtSignature: null);
  return (
    id: data['id'] is String ? data['id'] as String : null,
    thoughtSignature: data['thoughtSignature'] is String
        ? data['thoughtSignature'] as String
        : null,
  );
}

/// Canonical messages → Gemini `contents`. A tool result must name the
/// function it answers (Gemini correlates by name), recovered by walking back
/// through the preceding assistant tool calls.
List<Map<String, dynamic>> _toGoogleContents(List<CanonicalMessage> messages) {
  final callById = <String, ToolCall>{};
  for (final message in messages) {
    if (message case AssistantToolCalls(:final toolCalls)) {
      for (final call in toolCalls) {
        callById[call.id] = call;
      }
    }
  }

  final out = <Map<String, dynamic>>[];

  void appendPart(String role, Map<String, dynamic> part) {
    final last = out.isEmpty ? null : out.last;
    if (last != null && last['role'] == role && last['parts'] is List) {
      (last['parts'] as List).add(part);
    } else {
      out.add({
        'role': role,
        'parts': [part]
      });
    }
  }

  for (final message in messages) {
    switch (message) {
      case ToolResultMessage(:final toolCallId, :final content):
        final call = callById[toolCallId];
        final state = _googleCallState(call?.providerData);
        appendPart('user', {
          'functionResponse': {
            'name': call?.name ?? toolCallId,
            // Only when Gemini issued the id itself — pairing a response with
            // an id the model never sent is worse than sending none.
            if (state.id != null) 'id': state.id,
            'response': {'result': content},
          },
        });

      case AssistantToolCalls(:final toolCalls):
        for (final call in toolCalls) {
          final state = _googleCallState(call.providerData);
          appendPart('model', {
            'functionCall': {
              'name': call.name,
              'args': call.arguments,
              if (state.id != null) 'id': state.id,
            },
            // Sibling of functionCall, not a field inside it — Gemini rejects
            // the request if this is nested or missing.
            if (state.thoughtSignature != null)
              'thoughtSignature': state.thoughtSignature,
          });
        }

      case UserMessage(:final content):
        appendPart('user', {'text': content});
      case AssistantMessage(:final content):
        appendPart('model', {'text': content});
    }
  }

  return out;
}

Map<String, dynamic> _toGoogleTool(ToolSchema tool) => {
      'name': tool.name,
      'description': tool.description,
      'parameters': tool.parameters,
    };
