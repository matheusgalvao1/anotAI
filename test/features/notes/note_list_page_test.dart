import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/controllers/notes_controller.dart';
import 'package:anotai/features/notes/data/in_memory_notes_repository.dart';
import 'package:anotai/features/notes/views/note_list_page.dart';

void main() {
  Widget wrap(NotesController controller) => MaterialApp(
        home: NoteListPage(
          controller: controller,
          createEditorController: (note) => throw UnimplementedError(),
          onOpenSettings: (_) {},
        ),
      );

  testWidgets('swiping a note asks for confirmation before deleting',
      (tester) async {
    final repository = InMemoryNotesRepository.seeded();
    final controller = NotesController(repository);
    addTearDown(controller.dispose);
    await controller.load();

    await tester.pumpWidget(wrap(controller));
    expect(find.text('Welcome to anotAI'), findsOneWidget);

    // Swipe the first note away.
    await tester.drag(
      find.text('Welcome to anotAI'),
      const Offset(-600, 0),
    );
    await tester.pumpAndSettle();

    // Confirmation dialog, not a silent delete.
    expect(find.text('Delete note?'), findsOneWidget);

    // Cancelling keeps the note.
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome to anotAI'), findsOneWidget);
  });

  testWidgets('confirming the dialog hard-deletes the note', (tester) async {
    final repository = InMemoryNotesRepository.seeded();
    final controller = NotesController(repository);
    addTearDown(controller.dispose);
    await controller.load();

    await tester.pumpWidget(wrap(controller));
    final countBefore = controller.notes.length;

    await tester.drag(
      find.text('Welcome to anotAI'),
      const Offset(-600, 0),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Welcome to anotAI'), findsNothing);
    expect(controller.notes, hasLength(countBefore - 1));
  });
}
