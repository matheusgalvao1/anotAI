import 'package:anotai/features/ai/data/agent/types.dart';

/// A scriptable [Provider] for loop/editor tests: each request is handed to
/// [respond], which can replay canned events (or throw to simulate transport
/// failures and cancellation).
class FakeProvider implements Provider {
  FakeProvider(this.respond);

  final Stream<ProviderStreamEvent> Function(ProviderRequest request) respond;
  final List<ProviderRequest> requests = [];

  @override
  Stream<ProviderStreamEvent> send(ProviderRequest request) {
    requests.add(request);
    return respond(request);
  }
}

/// A provider that yields a fixed list of events, checking the cancellation
/// token first so abort tests behave.
FakeProvider scriptedProvider(List<ProviderStreamEvent> events) => FakeProvider(
      (request) async* {
        request.cancellation.throwIfCancelled();
        for (final event in events) {
          request.cancellation.throwIfCancelled();
          yield event;
        }
      },
    );

ProviderStreamEvent text(String delta) => TextDelta(delta);

ProviderStreamEvent toolCall(ToolCall call) => ToolCallEvent(call);

ProviderStreamEvent error(ProviderErrorKind kind, String message) =>
    ProviderErrorMessage(ProviderError(kind: kind, message: message));
