import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/ai/controllers/settings_controller.dart';
import 'package:anotai/features/ai/data/ai_allow_list_repository.dart';
import 'package:anotai/features/ai/data/ai_settings_store.dart';
import 'package:anotai/features/ai/models/ai_allow_list.dart'
    show ReasoningMode;
import 'package:anotai/features/ai/models/provider_id.dart';
import 'package:anotai/features/ai/models/selection.dart';
import 'package:anotai/features/notes/data/file_notes_repository.dart';
import 'package:anotai/features/notes/data/note_transfer.dart';
import 'package:anotai/features/settings/controllers/appearance_controller.dart';
import 'package:anotai/features/settings/views/settings_page.dart';

const _allowListJson = {
  'providers': [
    {'id': 'openrouter', 'label': 'OpenRouter', 'keyPlaceholder': 'sk-or-v1'},
    {'id': 'openai', 'label': 'OpenAI', 'keyPlaceholder': 'sk-'},
  ],
  'models': [
    {
      'id': 'deepseek/deepseek-v4-flash',
      'label': 'DeepSeek V4 Flash',
      'provider': 'openrouter',
      'reasoning': {
        'modes': ['disabled', 'low', 'medium', 'high'],
        'default': 'medium'
      },
    },
    {
      'id': 'poolside/laguna-s-2.1',
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
};

SettingsController _controllerWith({bool openRouterKey = false}) {
  final store = InMemoryAiSettingsStore();
  if (openRouterKey) {
    store.writeKey(ProviderId.openrouter, 'sk-or-v1-test');
  }
  final controller = SettingsController(
    allowListRepository: AiAllowListRepository(
        loadSource: () async => jsonEncode(_allowListJson)),
    store: store,
  );
  return controller;
}

Widget _wrap(SettingsController settings) => MaterialApp(
      home: SettingsPage(
        controller: AppearanceController(),
        settingsController: settings,
      ),
    );

Future<SettingsController> _loaded(SettingsController controller) async {
  await controller.load();
  return controller;
}

void main() {
  testWidgets('shows providers and a model chooser', (tester) async {
    final settings = await _loaded(_controllerWith());
    await tester.pumpWidget(_wrap(settings));

    expect(find.text('AI PROVIDERS'), findsOneWidget);
    expect(find.text('AI MODEL'), findsOneWidget);
    expect(find.text('OpenRouter'), findsWidgets);
    expect(find.text('Choose a model'), findsOneWidget);
  });

  testWidgets('adding a provider key marks it configured', (tester) async {
    final settings = await _loaded(_controllerWith());
    await tester.pumpWidget(_wrap(settings));

    await tester.tap(find.text('Add').first);
    await tester.pumpAndSettle();

    expect(find.byType(TextField), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'sk-or-v1-test');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(settings.hasKey(settings.allowList!.providers.first.id), isTrue);
    // Only OpenAI's row remains unconfigured.
    expect(find.text('No key set'), findsOneWidget);
  });

  testWidgets('picking a model groups entries by provider', (tester) async {
    final settings = await _loaded(_controllerWith(openRouterKey: true));
    await tester.pumpWidget(_wrap(settings));

    await tester.tap(find.text('Choose a model'));
    await tester.pumpAndSettle();

    // Grouped by provider, the OpenRouter group lists its models first.
    expect(find.text('OPENROUTER'), findsOneWidget);
    expect(find.text('OPENAI'), findsOneWidget);
    expect(find.text('DeepSeek V4 Flash'), findsOneWidget);
    // OpenAI has no key, so its group is locked with a hint.
    expect(find.text('Add a OpenAI key to use this'), findsOneWidget);

    await tester.tap(find.text('DeepSeek V4 Flash'));
    await tester.pumpAndSettle();

    expect(settings.selection, isNotNull);
    expect(settings.selection!.modelId, 'deepseek/deepseek-v4-flash');
    expect(settings.selection!.reasoning, ReasoningMode.medium);
    // Reasoning chips come from the model's modes; no route-toggle exists.
    expect(find.text('REASONING'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Medium'), findsOneWidget);
    expect(find.text('CONNECTION'), findsNothing);
  });

  testWidgets('a stale selection falls back to the model chooser',
      (tester) async {
    final store = InMemoryAiSettingsStore();
    await store.writeKey(ProviderId.openrouter, 'sk-or-v1-test');
    // A selection referencing a model id that no longer exists in the allow
    // list must not render an empty card.
    await store.writeSelection(const ModelSelection(
      modelId: 'removed-model',
      reasoning: ReasoningMode.medium,
    ));
    final controller = SettingsController(
      allowListRepository: AiAllowListRepository(
          loadSource: () async => jsonEncode(_allowListJson)),
      store: store,
    );
    await controller.load();

    expect(controller.selection, isNull);

    await tester.pumpWidget(_wrap(controller));
    expect(find.text('Choose a model'), findsOneWidget);
  });

  testWidgets('importing notes invokes the refresh callback', (tester) async {
    final settings = await _loaded(_controllerWith());

    // No real file I/O runs here (widget-test fake async): the picker returns
    // no paths and the repository root is never touched, so the only thing we
    // verify is that the refresh callback fires after an import attempt.
    var refreshed = 0;
    final transfer = NoteTransfer(
      notesRepository: FileNotesRepository(Directory(
          '${Directory.systemTemp.path}${Platform.pathSeparator}anotai-widget-test')),
      pickMarkdownFiles: () async => const [],
      shareFiles: (paths, origin) async {},
    );

    await tester.pumpWidget(MaterialApp(
      home: SettingsPage(
        controller: AppearanceController(),
        settingsController: settings,
        noteTransfer: transfer,
        onNotesImported: () => refreshed++,
      ),
    ));

    await tester.ensureVisible(find.text('Import'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Import'));
    await tester.pumpAndSettle();

    expect(refreshed, 1);
    expect(find.text('Notes imported.'), findsOneWidget);
  });
}
