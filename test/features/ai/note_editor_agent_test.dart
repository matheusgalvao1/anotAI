import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/ai/controllers/agent_controller.dart';
import 'package:anotai/features/ai/data/agent/types.dart';
import 'package:anotai/features/ai/data/ai_settings_store.dart';
import 'package:anotai/features/ai/models/ai_allow_list.dart';
import 'package:anotai/features/ai/models/provider_id.dart';
import 'package:anotai/features/ai/models/selection.dart';
import 'package:anotai/features/notes/controllers/note_editor_controller.dart';
import 'package:anotai/features/notes/data/in_memory_notes_repository.dart';
import 'fake_provider.dart';

AiAllowList _allowList() {
  final raw = AiAllowList.tryParse({
    'providers': [
      {'id': 'openrouter', 'label': 'OpenRouter', 'keyPlaceholder': 'sk-or-v1'},
      {'id': 'openai', 'label': 'OpenAI', 'keyPlaceholder': 'sk-'},
    ],
    'models': [
      {
        'id': 'openai/gpt-5.6-sol',
        'label': 'GPT 5.6 Sol',
        'provider': 'openrouter',
        'reasoning': {
          'modes': ['minimal', 'low', 'medium', 'high'],
          'default': 'medium'
        },
      },
      {
        'id': 'laguna-s-2.1',
        'label': 'Laguna S 2.1',
        'provider': 'openrouter',
        'reasoning': {
          'modes': ['disabled', 'enabled'],
          'default': 'enabled'
        },
      },
      {
        'id': 'gpt-5.6-sol',
        'label': 'GPT 5.6 Sol',
        'provider': 'openai',
        'reasoning': {
          'modes': ['minimal', 'low', 'medium', 'high'],
          'default': 'medium'
        },
      },
    ],
  });
  return raw!;
}

void main() {
  test(
      'submitPrompt runs a real agent turn through the provider factory wiring',
      () async {
    final store = InMemoryAiSettingsStore();
    await store.writeKey(ProviderId.openai, 'sk-test');
    await store.writeSelection(const ModelSelection(
      modelId: 'gpt-5.6-sol',
      reasoning: ReasoningMode.medium,
    ));

    final repository = InMemoryNotesRepository.seeded();
    final note = await repository.create();
    final rewritten = 'note rewritten by ai';

    var requests = 0;
    final agentController = AgentController(
      settings: store,
      allowList: _allowList(),
      providerBuilder: (
          {required provider,
          required apiKey,
          required model,
          required reasoning}) {
        // The factory wiring picks the entry's provider + id and the selection's
        // reasoning.
        expect(provider, ProviderId.openai);
        expect(model, 'gpt-5.6-sol');
        expect(reasoning, ReasoningMode.medium);
        return FakeProvider((request) async* {
          request.cancellation.throwIfCancelled();
          requests++;
          if (requests == 1) {
            yield ToolCallEvent(ToolCall(
              id: 'rewrite-1',
              name: 'rewrite_note',
              arguments: {'content': rewritten},
            ));
          } else {
            yield TextDelta('Rewrote it.');
          }
        });
      },
    );

    final controller = NoteEditorController(
      note: note,
      repository: repository,
      agentController: agentController,
    );

    final replaced = <String>[];
    controller.onBodyReplaced = replaced.add;

    await controller.submitPrompt('fix this');

    expect(controller.promptBusy, isFalse);
    expect(controller.promptStatus, 'Rewrote it.');
    expect(controller.note.body, rewritten);
    expect(replaced, [rewritten]);
    await controller.flush();
    final saved = await repository.find(note.id);
    expect(saved!.body, rewritten);
  });

  test('an OpenRouter entry is served through the openrouter adapter',
      () async {
    final store = InMemoryAiSettingsStore();
    await store.writeKey(ProviderId.openrouter, 'sk-or-v1-test');
    await store.writeSelection(const ModelSelection(
      modelId: 'openai/gpt-5.6-sol',
      reasoning: ReasoningMode.medium,
    ));

    final agentController = AgentController(
      settings: store,
      allowList: _allowList(),
      providerBuilder: (
          {required provider,
          required model,
          required apiKey,
          required reasoning}) {
        expect(provider, ProviderId.openrouter);
        expect(model, 'openai/gpt-5.6-sol');
        return FakeProvider((request) async* {
          request.cancellation.throwIfCancelled();
          yield TextDelta('ok');
        });
      },
    );

    expect(await agentController.providerForTurn(), isNotNull);
  });

  test('submitPrompt nudges the user to Settings when nothing is configured',
      () async {
    final store = InMemoryAiSettingsStore();
    final repository = InMemoryNotesRepository.seeded();
    final note = await repository.create();
    final controller = NoteEditorController(
      note: note,
      repository: repository,
      agentController:
          AgentController(settings: store, allowList: _allowList()),
    );

    await controller.submitPrompt('fix this');

    expect(controller.promptStatus, contains('Settings'));
    expect(controller.note.body, note.body);
  });

  test('submitPrompt falls back to the placeholder when no agent wiring exists',
      () async {
    final repository = InMemoryNotesRepository.seeded();
    final note = await repository.create();
    final controller = NoteEditorController(note: note, repository: repository);

    await controller.submitPrompt('fix this');

    expect(controller.promptStatus, contains('next phase'));
  });
}
