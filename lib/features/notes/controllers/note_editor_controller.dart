import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/notes_repository.dart';
import '../models/note.dart';

class NoteEditorController extends ChangeNotifier {
  NoteEditorController({required Note note, required this.repository})
      : _note = note;

  static const saveDelay = Duration(milliseconds: 450);

  final NotesRepository repository;
  Note _note;
  Timer? _saveTimer;
  bool _promptOpen = false;
  String? _promptStatus;

  Note get note => _note;
  bool get promptOpen => _promptOpen;
  String? get promptStatus => _promptStatus;

  void updateBody(String body) {
    _note = _note.copyWith(body: body, updatedAt: DateTime.now());
    _saveTimer?.cancel();
    _saveTimer = Timer(saveDelay, () => unawaited(_save()));
  }

  void openPrompt() {
    _promptOpen = true;
    _promptStatus = null;
    notifyListeners();
  }

  void closePrompt() {
    _promptOpen = false;
    _promptStatus = null;
    notifyListeners();
  }

  void submitPrompt(String prompt) {
    if (prompt.trim().isEmpty) return;
    _promptStatus = 'AI editing will be connected in the next phase.';
    notifyListeners();
  }

  Future<void> flush() async {
    _saveTimer?.cancel();
    _saveTimer = null;
    await _save();
  }

  Future<void> _save() => repository.save(_note);

  @override
  void dispose() {
    _saveTimer?.cancel();
    unawaited(_save());
    super.dispose();
  }
}
