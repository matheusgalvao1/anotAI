/// Signals that the underlying storage itself failed. Deliberately NOT treated
/// as a tool error the model can retry: silent data loss is the worst outcome
/// in a notes app, so the loop rethrows it and the UI surfaces it loudly. Tool
/// *argument* problems are the recoverable kind; storage failures are not.
class NoteStoreError implements Exception {
  const NoteStoreError(this.message, [this.cause]);

  final String message;
  final Object? cause;

  @override
  String toString() => message;
}

/// The agent loop's only view of note content. The app wires this to the live
/// editing buffer; tests use the in-memory implementation so the loop and
/// tools run with no platform dependencies.
abstract interface class NoteStore {
  String read();

  void write(String content);
}

class InMemoryNoteStore implements NoteStore {
  InMemoryNoteStore([this._content = '']);

  String _content;

  @override
  String read() => _content;

  @override
  void write(String content) {
    _content = content;
  }
}
