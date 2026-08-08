import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../ai/controllers/agent_controller.dart';
import '../../ai/data/agent/loop.dart';
import '../../ai/data/agent/note_store.dart';
import '../../ai/data/agent/types.dart';
import '../data/notes_repository.dart';
import '../models/note.dart';

class NoteEditorController extends ChangeNotifier {
  NoteEditorController({
    required Note note,
    required NotesRepository repository,
    AgentController? agentController,
  })  : _note = note,
        _repository = repository,
        _agentController = agentController;

  static const saveDelay = Duration(milliseconds: 450);

  /// Stands in for the round trip to the AI provider when no agent wiring is
  /// present (tests, and the app before an agent controller is injected).
  static const placeholderThinkingDelay = Duration(milliseconds: 1400);

  final NotesRepository _repository;
  final AgentController? _agentController;
  Note _note;
  Timer? _saveTimer;
  bool _promptOpen = false;
  bool _promptBusy = false;
  bool _disposed = false;
  String? _promptStatus;
  List<CanonicalMessage> _history = const [];

  /// The note editor sets this so the visible field follows agent-written
  /// bodies as they land.
  void Function(String body)? onBodyReplaced;

  Note get note => _note;
  bool get promptOpen => _promptOpen;
  bool get promptBusy => _promptBusy;
  String? get promptStatus => _promptStatus;

  void updateBody(String body) {
    if (_disposed) return;
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

    final agent = _agentController;
    if (agent == null) {
      await Future<void>.delayed(placeholderThinkingDelay);
      if (_disposed || !_promptBusy) return;
      _promptBusy = false;
      _promptStatus = 'AI editing will be connected in the next phase.';
      notifyListeners();
      return;
    }

    try {
      final provider = await agent.providerForTurn();
      if (provider == null) {
        _promptStatus =
            'Add a provider API key and pick a model in Settings to use AI editing.';
        return;
      }

      final result = await runTurn(RunTurnParams(
        prompt: prompt,
        noteTitle: _note.title,
        store: _EditorNoteStore(this),
        history: _history,
        provider: provider,
      ));

      if (_disposed) return;
      _history = result.updatedHistory;
      _promptStatus = result.finalText;
    } on AgentProviderError catch (error) {
      _promptStatus = error.providerError.message;
    } catch (error) {
      _promptStatus = 'AI editing failed: $error';
    } finally {
      _promptBusy = false;
      notifyListeners();
    }
  }

  /// Applies (or reverts) an agent-written body to the note, the visible
  /// field, and the save queue.
  void _applyAiBody(String content) {
    if (_disposed) return;
    _note = _note.copyWith(body: content, updatedAt: DateTime.now());
    onBodyReplaced?.call(content);
    _saveTimer?.cancel();
    _saveTimer = Timer(saveDelay, () => unawaited(_save()));
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

/// The agent loop's view of the note: reads the live body, and every write
/// flows back through [NoteEditorController._applyAiBody] so the visible field
/// and persistence follow the agent's edits.
class _EditorNoteStore implements NoteStore {
  _EditorNoteStore(this._controller);

  final NoteEditorController _controller;

  @override
  String read() => _controller._note.body;

  @override
  void write(String content) => _controller._applyAiBody(content);
}
