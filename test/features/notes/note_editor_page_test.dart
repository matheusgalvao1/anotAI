import 'package:anotai/core/widgets/thinking_orb/thinking_orb.dart';
import 'package:anotai/features/notes/controllers/note_editor_controller.dart';
import 'package:anotai/features/notes/data/in_memory_notes_repository.dart';
import 'package:anotai/features/notes/models/note.dart';
import 'package:anotai/features/notes/views/note_editor_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// The orbs animate indefinitely, so these tests pump explicit frames instead
// of settling.
Future<void> _pumpFrames(WidgetTester tester, [int frames = 2]) async {
  for (var i = 0; i < frames; i++) {
    await tester.pump(const Duration(milliseconds: 16));
  }
}

Future<NoteEditorController> _mountEditor(WidgetTester tester) async {
  final now = DateTime(2026, 8, 1);
  final note = Note(
    id: 'editor-test',
    body: List.generate(60, (index) => 'Scrollable line $index').join('\n'),
    createdAt: now,
    updatedAt: now,
  );
  final repository = InMemoryNotesRepository.seeded();
  await repository.save(note);
  final controller = NoteEditorController(note: note, repository: repository);

  await tester.pumpWidget(
    MaterialApp(home: NoteEditorPage(controller: controller)),
  );
  return controller;
}

void main() {
  testWidgets(
      'opening the AI prompt makes the note read-only and focuses the prompt',
      (tester) async {
    await _mountEditor(tester);

    var editor = tester.widget<TextField>(find.byKey(const Key('note-editor')));
    expect(editor.readOnly, isFalse);

    await tester.tap(find.byKey(const Key('ai-open-button')));
    await _pumpFrames(tester);

    editor = tester.widget<TextField>(find.byKey(const Key('note-editor')));
    final prompt =
        tester.widget<TextField>(find.byKey(const Key('ai-prompt-input')));
    expect(editor.readOnly, isTrue);
    expect(editor.scrollController, isNotNull);
    expect(prompt.focusNode!.hasFocus, isTrue);
  });

  testWidgets('the orb tracks the AI prompt state', (tester) async {
    final controller = await _mountEditor(tester);
    await _pumpFrames(tester);

    ThinkingOrbState orbState(Key key) =>
        tester.widget<ThinkingOrb>(find.byKey(key)).state;

    expect(
      tester.widget<ThinkingOrb>(find.byType(ThinkingOrb)).state,
      ThinkingOrbState.composing,
    );

    await tester.tap(find.byKey(const Key('ai-open-button')));
    await _pumpFrames(tester);
    expect(orbState(const Key('ai-activity-orb')), ThinkingOrbState.working);

    await tester.enterText(
      find.byKey(const Key('ai-prompt-input')),
      'Tighten the second paragraph',
    );
    await _pumpFrames(tester);
    await tester.tap(find.byKey(const Key('ai-send-button')));
    await _pumpFrames(tester);

    expect(controller.promptBusy, isTrue);
    expect(orbState(const Key('ai-activity-orb')), ThinkingOrbState.solving);

    await tester.pump(NoteEditorController.placeholderThinkingDelay);
    await _pumpFrames(tester);

    expect(controller.promptBusy, isFalse);
    expect(orbState(const Key('ai-activity-orb')), ThinkingOrbState.working);
    expect(find.textContaining('next phase'), findsOneWidget);
  });

  testWidgets('tapping the orb closes the prompt', (tester) async {
    await _mountEditor(tester);

    await tester.tap(find.byKey(const Key('ai-open-button')));
    await _pumpFrames(tester);
    expect(find.byKey(const Key('ai-prompt-input')), findsOneWidget);

    await tester.tap(find.byKey(const Key('ai-activity-orb')));
    await _pumpFrames(tester);

    expect(find.byKey(const Key('ai-prompt-input')), findsNothing);
    final editor =
        tester.widget<TextField>(find.byKey(const Key('note-editor')));
    expect(editor.readOnly, isFalse);
  });
}
