import '../models/note.dart';

abstract interface class NotesRepository {
  Future<List<Note>> list();

  Future<Note?> find(String id);

  Future<Note> create();

  Future<void> save(Note note);

  Future<void> delete(String id);
}
