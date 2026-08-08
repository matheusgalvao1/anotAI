import 'package:flutter_test/flutter_test.dart';

import 'package:anotai/features/ai/data/agent/config.dart';
import 'package:anotai/features/ai/data/agent/loop.dart';
import 'package:anotai/features/ai/data/agent/note_store.dart';
import 'package:anotai/features/ai/data/agent/types.dart';
import 'fake_provider.dart';

void main() {
  test('completes with plain text and records the exchange', () async {
    final store = InMemoryNoteStore('hello');
    final provider = scriptedProvider([text('Hi there.')]);

    final result = await runTurn(RunTurnParams(
      prompt: 'Say hi',
      noteTitle: 'T',
      store: store,
      history: const [],
      provider: provider,
    ));

    expect(result.stoppedReason, StoppedReason.completed);
    expect(result.finalText, 'Hi there.');
    expect(result.bodyChanged, isFalse);
    expect(result.newBody, 'hello');
    expect(result.updatedHistory, hasLength(2));
    expect(result.updatedHistory.first, isA<UserMessage>());
    expect(result.updatedHistory.last, isA<AssistantMessage>());
  });

  test('executes a rewrite tool call, applies it, and continues', () async {
    final store = InMemoryNoteStore('original body');
    var requestCount = 0;
    final provider = FakeProvider((request) async* {
      request.cancellation.throwIfCancelled();
      requestCount++;
      if (requestCount == 1) {
        yield ToolCallEvent(ToolCall(
          id: 'rewrite-1',
          name: 'rewrite_note',
          arguments: const {'content': 'rewritten body'},
        ));
      } else {
        yield TextDelta('Done.');
      }
    });

    final result = await runTurn(RunTurnParams(
      prompt: 'Rewrite it',
      noteTitle: 'T',
      store: store,
      history: const [],
      provider: provider,
    ));

    expect(result.bodyChanged, isTrue);
    expect(store.read(), 'rewritten body');
    expect(result.newBody, 'rewritten body');
    expect(result.finalText, 'Done.');
    expect(result.toolCallsExecuted, 1);
    expect(result.updatedHistory.whereType<AssistantToolCalls>(), isNotEmpty);
    expect(result.updatedHistory.whereType<ToolResultMessage>(), isNotEmpty);
  });

  test('a cancelled run discards the turn and its history', () async {
    final store = InMemoryNoteStore('body');
    final token = CancellationToken()..cancel();
    final history = <CanonicalMessage>[AssistantMessage('earlier')];
    final provider = FakeProvider((request) async* {
      request.cancellation.throwIfCancelled();
      yield TextDelta('should not land');
    });

    final result = await runTurn(RunTurnParams(
      prompt: 'hi',
      noteTitle: 'T',
      store: store,
      history: history,
      provider: provider,
      cancellation: token,
    ));

    expect(result.stoppedReason, StoppedReason.cancelled);
    expect(result.finalText, 'Cancelled');
    expect(result.updatedHistory, history);
    expect(store.read(), 'body');
  });

  test('a timeout is reported as timed out, not cancelled', () async {
    final store = InMemoryNoteStore('body');
    final token = CancellationToken(reason: turnTimeoutReason)..cancel();

    final result = await runTurn(RunTurnParams(
      prompt: 'hi',
      noteTitle: 'T',
      store: store,
      history: const [],
      provider: scriptedProvider([text('x')]),
      cancellation: token,
    ));

    expect(result.stoppedReason, StoppedReason.timedOut);
    expect(result.finalText, 'Timed out');
  });

  test('a provider error surfaces as AgentProviderError', () async {
    final store = InMemoryNoteStore('body');
    final provider =
        scriptedProvider([error(ProviderErrorKind.auth, 'Bad key')]);

    await expectLater(
      runTurn(RunTurnParams(
        prompt: 'hi',
        noteTitle: 'T',
        store: store,
        history: const [],
        provider: provider,
      )),
      throwsA(isA<AgentProviderError>()),
    );
  });

  test('stops at max iterations when the model keeps calling tools', () async {
    final store = InMemoryNoteStore('body');
    final provider = FakeProvider((request) async* {
      request.cancellation.throwIfCancelled();
      yield ToolCallEvent(ToolCall(
        id: 'loop',
        name: 'rewrite_note',
        arguments: const {'content': 'same'},
      ));
    });

    final result = await runTurn(RunTurnParams(
      prompt: 'change it',
      noteTitle: 'T',
      store: store,
      history: const [],
      provider: provider,
    ));

    expect(result.stoppedReason, StoppedReason.maxIterations);
    expect(
        result.finalText, 'Stopped after ${AgentConfig.maxIterations} steps.');
    expect(result.toolCallsExecuted, AgentConfig.maxIterations);
  });

  test('onNoteWritten fires only for tools that changed the note', () async {
    final store = InMemoryNoteStore('original');
    final written = <String>[];
    var requestCount = 0;
    final provider = FakeProvider((request) async* {
      request.cancellation.throwIfCancelled();
      requestCount++;
      if (requestCount == 1) {
        yield ToolCallEvent(ToolCall(
          id: 'read-1',
          name: 'read_note',
          arguments: const {},
        ));
      } else if (requestCount == 2) {
        yield ToolCallEvent(ToolCall(
          id: 'rewrite-1',
          name: 'rewrite_note',
          arguments: const {'content': 'changed'},
        ));
      } else {
        yield TextDelta('Done.');
      }
    });

    await runTurn(RunTurnParams(
      prompt: 'go',
      noteTitle: 'T',
      store: store,
      history: const [],
      provider: provider,
      onNoteWritten: (before, after) => written.add(after),
    ));

    expect(written, ['changed']);
  });
}
