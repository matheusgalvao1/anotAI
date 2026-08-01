import 'package:anotai/features/notes/controllers/note_editor_controller.dart';
import 'package:anotai/features/notes/data/in_memory_notes_repository.dart';
import 'package:anotai/features/notes/models/note.dart';
import 'package:anotai/features/notes/views/note_editor_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
      'opening the AI prompt makes the note read-only and focuses the prompt',
      (tester) async {
    final now = DateTime(2026, 8, 1);
    final note = Note(
      id: 'editor-test',
      body: List.generate(60, (index) => 'Scrollable line $index').join('\n'),
      createdAt: now,
      updatedAt: now,
    );
    final repository = InMemoryNotesRepository.seeded();
    await repository.save(note);

    await tester.pumpWidget(
      MaterialApp(
        home: NoteEditorPage(
          controller: NoteEditorController(note: note, repository: repository),
        ),
      ),
    );

    var editor = tester.widget<TextField>(find.byKey(const Key('note-editor')));
    expect(editor.readOnly, isFalse);

    await tester.tap(find.byKey(const Key('ai-open-button')));
    await tester.pumpAndSettle();

    editor = tester.widget<TextField>(find.byKey(const Key('note-editor')));
    final prompt =
        tester.widget<TextField>(find.byKey(const Key('ai-prompt-input')));
    expect(editor.readOnly, isTrue);
    expect(editor.scrollController, isNotNull);
    expect(prompt.focusNode!.hasFocus, isTrue);
  });
}
