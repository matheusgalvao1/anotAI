import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/controllers/notes_controller.dart';
import 'package:anotai/features/notes/data/in_memory_notes_repository.dart';

void main() {
  test('create, delete, and restore stay behind the repository boundary',
      () async {
    final repository = InMemoryNotesRepository.seeded();
    final controller = NotesController(repository);
    addTearDown(controller.dispose);

    await controller.load();
    final initialCount = controller.notes.length;
    final note = await controller.createNote();
    expect(controller.notes, hasLength(initialCount + 1));

    final deleted = await controller.deleteNote(note.id);
    expect(deleted, isNotNull);
    expect(controller.notes, hasLength(initialCount));

    await controller.restoreNote(deleted!);
    expect(controller.notes, hasLength(initialCount + 1));
  });
}
