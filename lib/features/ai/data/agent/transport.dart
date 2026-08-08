import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'types.dart';

/// The response shape adapters work against, structural so tests can fake it.
abstract interface class HttpResponseLike {
  bool get ok;
  int get status;

  /// Null when the implementation cannot stream — adapters then report it
  /// rather than pretending.
  Stream<List<int>>? get body;

  /// Reads the whole body as text (error payloads, non-streaming responses).
  Future<String> text();
}

class _StreamedHttpResponse implements HttpResponseLike {
  _StreamedHttpResponse(this._response);

  final http.StreamedResponse _response;

  @override
  bool get ok => _response.statusCode >= 200 && _response.statusCode < 300;

  @override
  int get status => _response.statusCode;

  @override
  Stream<List<int>>? get body => _response.stream;

  @override
  Future<String> text() => _response.stream.bytesToString();
}

/// The tiny slice of the network transport the provider adapters need,
/// injectable for tests. The app wires the real implementation in the
/// composition root.
abstract interface class HttpTransport {
  Future<HttpResponseLike> post(
    Uri url, {
    required Map<String, String> headers,
    required String body,
    CancellationToken? token,
  });
}

class HttpTransportImpl implements HttpTransport {
  HttpTransportImpl([http.Client? client]) : _client = client ?? http.Client();

  final http.Client _client;

  @override
  Future<HttpResponseLike> post(
    Uri url, {
    required Map<String, String> headers,
    required String body,
    CancellationToken? token,
  }) async {
    token?.throwIfCancelled();
    final request = http.Request('POST', url)
      ..headers.addAll(headers)
      ..body = body;
    final response = await _client.send(request);
    return _StreamedHttpResponse(response);
  }
}

/// Transports the status into the kind, shared so one provider can't quietly
/// disagree about what 429 means.
ProviderErrorKind httpErrorKind(int status) {
  if (status == 401 || status == 403) return ProviderErrorKind.auth;
  if (status == 402) return ProviderErrorKind.insufficientCredits;
  if (status == 429) return ProviderErrorKind.rateLimit;
  if (status == 404) return ProviderErrorKind.notFound;
  return ProviderErrorKind.unknown;
}

/// Whether a 400 is the provider saying this model can't use tools *here*.
///
/// Status alone can't tell — the "you asked for something this model won't do"
/// failures arrive as a generic 400 with the reason only in prose. This reads
/// the message and requires both a tool mention and an explicit refusal so a
/// miss degrades to showing the real text instead of a wrong diagnosis.
bool isToolSupportError(int status, String message) {
  if (status != 400) return false;
  final m = message.toLowerCase();
  final mentionsTools = m.contains('tool') || m.contains('function');
  final refuses = m.contains('not supported') ||
      m.contains('unsupported') ||
      m.contains('does not support');
  return mentionsTools && refuses;
}

/// Whether a 400 is the provider saying it has never heard of this model
/// (OpenAI's `/v1/responses` answers unknown models with a 400, not a 404).
bool isModelNotFoundError(int status, String message) {
  if (status != 400) return false;
  final m = message.toLowerCase();
  if (!m.contains('model')) return false;
  return m.contains('does not exist') ||
      m.contains('not found') ||
      m.contains('unknown model');
}

/// The kind for a failed HTTP response, given both the status and what the
/// body said. Prefer this over [httpErrorKind] at an adapter's error
/// boundary: status is enough for the well-known codes, but not for the 400s
/// that only differ in prose.
ProviderErrorKind classifyHttpError(int status, String message) {
  if (isToolSupportError(status, message)) {
    return ProviderErrorKind.noToolSupport;
  }
  if (isModelNotFoundError(status, message)) {
    return ProviderErrorKind.notFound;
  }
  return httpErrorKind(status);
}

/// Reads a provider's error message without assuming a shape. OpenAI-shaped
/// endpoints and Anthropic nest under `error.message`; Google returns
/// `error.message` too. Anything unrecognised falls back to the caller's
/// generic message.
String errorMessageFromBody(String body, String fallback) {
  try {
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      final message = decoded['error'];
      if (message is Map<String, dynamic> && message['message'] is String) {
        return message['message'] as String;
      }
      if (message is String && message.isNotEmpty) return message;
    }
  } catch (_) {
    // fall through
  }
  return fallback;
}

/// Classifies a transport failure. An aborted token is the reliable evidence,
/// not the error's shape — every transport words cancellation differently.
ProviderError toTransportError(Object? error, CancellationToken? token) {
  if (token?.isCancelled == true || error is CancelledException) {
    return const ProviderError(
        kind: ProviderErrorKind.cancelled,
        message: 'The request was cancelled.');
  }
  return ProviderError(
    kind: ProviderErrorKind.network,
    message: error is Exception ? error.toString() : 'Network request failed.',
  );
}

UsageEvent? usageEvent(int? inputTokens, int? outputTokens) {
  if (inputTokens == null || outputTokens == null) return null;
  return UsageEvent(inputTokens: inputTokens, outputTokens: outputTokens);
}

class SseEvent {
  const SseEvent({required this.event, required this.data});

  /// Empty when the stream only carries `data:` frames.
  final String event;
  final String data;
}

/// Splits an SSE byte stream into events, decoding one complete line at a
/// time so a multi-byte UTF-8 character can never be split across chunk
/// boundaries (`\n` is not a UTF-8 continuation byte).
///
/// [token] is checked between chunks so cancellation stops reading promptly.
Stream<SseEvent> readSseEvents(Stream<List<int>> bytes,
    {CancellationToken? token}) async* {
  final decoder = const Utf8Decoder(allowMalformed: true);
  var pending = <int>[];
  final readyEvents = <SseEvent>[];
  var dataLines = <String>[];
  var eventType = '';

  void processLine(List<int> rawLine) {
    var line = decoder.convert(rawLine);
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }
    if (line.isEmpty) {
      if (dataLines.isNotEmpty) {
        readyEvents.add(SseEvent(event: eventType, data: dataLines.join('\n')));
        dataLines = <String>[];
        eventType = '';
      }
      return;
    }
    if (line.startsWith(':')) return; // comment
    if (line.startsWith('data:')) {
      var value = line.substring(5);
      if (value.startsWith(' ')) value = value.substring(1);
      dataLines.add(value);
      return;
    }
    if (line.startsWith('event:')) {
      eventType = line.substring(6).trim();
    }
  }

  await for (final chunk in bytes) {
    token?.throwIfCancelled();
    pending.addAll(chunk);
    while (true) {
      final nl = pending.indexOf(0x0A);
      if (nl == -1) break;
      processLine(pending.sublist(0, nl));
      pending = pending.sublist(nl + 1);
    }
    while (readyEvents.isNotEmpty) {
      final next = readyEvents.removeAt(0);
      yield next;
    }
  }

  // Flush anything after the final newline, then a data-only event with no
  // terminating blank line.
  if (pending.isNotEmpty) processLine(pending);
  if (dataLines.isNotEmpty) {
    yield SseEvent(event: eventType, data: dataLines.join('\n'));
  }
  while (readyEvents.isNotEmpty) {
    final next = readyEvents.removeAt(0);
    yield next;
  }
}

/// Shortcut for classifying a failed response into the error the loop reports.
ProviderError classifiedError(int status, String message, String fallback) =>
    ProviderError(
      kind: classifyHttpError(status, message),
      message: message.isNotEmpty ? message : fallback,
      status: status,
    );
