import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/notes_repository.dart';
import '../models/note.dart';

class NoteEditorController extends ChangeNotifier {
  NoteEditorController({
    required Note note,
    required NotesRepository repository,
  })  : _note = note,
        _repository = repository;

  static const saveDelay = Duration(milliseconds: 450);

  /// Stands in for the round trip to the AI provider until it is connected.
  static const placeholderThinkingDelay = Duration(milliseconds: 1400);

  final NotesRepository _repository;
  Note _note;
  Timer? _saveTimer;
  bool _promptOpen = false;
  bool _promptBusy = false;
  bool _disposed = false;
  String? _promptStatus;

  Note get note => _note;
  bool get promptOpen => _promptOpen;
  bool get promptBusy => _promptBusy;
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
    _promptBusy = false;
    _promptStatus = null;
    notifyListeners();
  }

  Future<void> submitPrompt(String prompt) async {
    if (prompt.trim().isEmpty || _promptBusy) return;
    _promptBusy = true;
    _promptStatus = null;
    notifyListeners();

    await Future<void>.delayed(placeholderThinkingDelay);
    if (_disposed || !_promptBusy) return;

    _promptBusy = false;
    _promptStatus = 'AI editing will be connected in the next phase.';
    notifyListeners();
  }

  Future<void> flush() async {
    _saveTimer?.cancel();
    _saveTimer = null;
    await _save();
  }

  Future<void> _save() => _repository.save(_note);

  @override
  void dispose() {
    _disposed = true;
    _saveTimer?.cancel();
    unawaited(_save());
    super.dispose();
  }
}
