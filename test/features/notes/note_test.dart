import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/models/note.dart';

void main() {
  group('Note', () {
    final now = DateTime(2026, 8, 1);

    test('derives a plain title from the first meaningful markdown line', () {
      final note = Note(
        id: '1',
        body: '\n# **Release** plan\n\nShip the first slice.',
        createdAt: now,
        updatedAt: now,
      );

      expect(note.title, 'Release plan');
      expect(note.preview, 'Ship the first slice.');
    });

    test('uses New Note for an empty document', () {
      final note = Note(id: '1', body: '', createdAt: now, updatedAt: now);

      expect(note.title, 'New Note');
      expect(note.preview, isEmpty);
    });
  });
}
