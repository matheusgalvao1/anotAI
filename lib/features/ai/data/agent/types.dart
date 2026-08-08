/// The canonical conversation shape the agent loop and every provider adapter
/// share. Adapters translate these to their own wire formats; nothing platform
/// specific lives here.
library;

/// One pending tool call produced by the model.
class ToolCall {
  const ToolCall({
    required this.id,
    required this.name,
    required this.arguments,
    this.providerData,
  });

  final String id;
  final String name;
  final Map<String, dynamic> arguments;

  /// Opaque per-provider state that must be handed back verbatim when this
  /// call is replayed in history. Nothing outside the adapter that produced it
  /// may read or depend on the shape.
  ///
  /// It exists because some APIs sign their own tool calls and then reject a
  /// conversation that returns the call without the signature (Gemini's
  /// `thought_signature`, OpenAI's reasoning items).
  final Object? providerData;
}

/// A message in the canonical history.
sealed class CanonicalMessage {
  const CanonicalMessage();
}

class UserMessage extends CanonicalMessage {
  const UserMessage(this.content);
  final String content;
}

class AssistantMessage extends CanonicalMessage {
  const AssistantMessage(this.content);
  final String content;
}

class AssistantToolCalls extends CanonicalMessage {
  const AssistantToolCalls(this.toolCalls);
  final List<ToolCall> toolCalls;
}

class ToolResultMessage extends CanonicalMessage {
  const ToolResultMessage({required this.toolCallId, required this.content});
  final String toolCallId;
  final String content;
}

/// A JSON-schema-ish tool declaration sent to providers.
class ToolSchema {
  const ToolSchema({
    required this.name,
    required this.description,
    required this.parameters,
  });

  final String name;
  final String description;

  /// JSON-compatible map: `{type, properties, required, …}`.
  final Map<String, dynamic> parameters;

  Map<String, dynamic> toJson() => {
        'type': 'function',
        'function': {
          'name': name,
          'description': description,
          'parameters': parameters,
        },
      };
}

enum ProviderErrorKind {
  auth,
  rateLimit,
  insufficientCredits,
  notFound,
  noToolSupport,
  cancelled,
  timeout,
  network,
  unknown,
}

class ProviderError {
  const ProviderError({
    required this.kind,
    required this.message,
    this.status,
  });

  final ProviderErrorKind kind;
  final String message;
  final int? status;

  @override
  String toString() => 'ProviderError(${kind.name}): $message';
}

sealed class ProviderStreamEvent {
  const ProviderStreamEvent();
}

class TextDelta extends ProviderStreamEvent {
  const TextDelta(this.delta);
  final String delta;
}

class ToolCallEvent extends ProviderStreamEvent {
  const ToolCallEvent(this.call);
  final ToolCall call;
}

class UsageEvent extends ProviderStreamEvent {
  const UsageEvent({required this.inputTokens, required this.outputTokens});
  final int inputTokens;
  final int outputTokens;
}

class ProviderErrorMessage extends ProviderStreamEvent {
  const ProviderErrorMessage(this.error);
  final ProviderError error;
}

/// The one way a request can be stopped. Providers check [isCancelled]
/// between chunks and stop reading rather than cooling the whole socket.
///
/// The `reason` describes why a fired token was cancelled (e.g. a timeout),
/// so the caller can report "Timed out" rather than "Cancelled".
class CancellationToken {
  CancellationToken({this.reason});

  factory CancellationToken.none() => CancellationToken();

  final String? reason;
  bool _cancelled = false;

  bool get isCancelled => _cancelled;

  void cancel() {
    _cancelled = true;
  }

  /// Throws [CancelledException] when the token has fired.
  void throwIfCancelled() {
    if (isCancelled) throw CancelledException(reason);
  }
}

class CancelledException implements Exception {
  const CancelledException(this.reason);
  final String? reason;

  @override
  String toString() => reason ?? 'Cancelled';
}

class ProviderRequest {
  const ProviderRequest({
    required this.system,
    required this.messages,
    required this.tools,
    required this.cancellation,
  });

  final String system;
  final List<CanonicalMessage> messages;
  final List<ToolSchema> tools;
  final CancellationToken cancellation;
}

/// Everything the agent loop needs from an LLM backend. Four adapters
/// implement it (OpenRouter, OpenAI, Anthropic, Google Gemini) and the loop
/// knows about none of them.
abstract interface class Provider {
  Stream<ProviderStreamEvent> send(ProviderRequest request);
}
