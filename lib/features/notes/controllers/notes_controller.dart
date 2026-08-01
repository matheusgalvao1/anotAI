import 'package:flutter/foundation.dart';

import '../data/notes_repository.dart';
import '../models/note.dart';

class NotesController extends ChangeNotifier {
  NotesController(this.repository);

  final NotesRepository repository;

  List<Note> _notes = const [];
  bool _isLoading = false;
  Object? _error;

  List<Note> get notes => _notes;
  bool get isLoading => _isLoading;
  Object? get error => _error;

  Future<void> load() async {
    _isLoading = true;
    _error = null;
    notifyListeners();
    try {
      _notes = await repository.list();
    } catch (error) {
      _error = error;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<Note> createNote() async {
    final note = await repository.create();
    await load();
    return note;
  }

  Future<Note?> deleteNote(String id) async {
    final deleted = await repository.find(id);
    if (deleted == null) return null;
    await repository.delete(id);
    await load();
    return deleted;
  }

  Future<void> restoreNote(Note note) async {
    await repository.save(note);
    await load();
  }
}
