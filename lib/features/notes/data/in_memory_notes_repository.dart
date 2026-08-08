import '../models/note.dart';
import 'notes_repository.dart';

/// A UI-stage repository. The interface is intentionally storage-agnostic so
/// the next phase can replace this with markdown files without changing a view.
class InMemoryNotesRepository implements NotesRepository {
  InMemoryNotesRepository._(Iterable<Note> notes)
      : _notes = {for (final note in notes) note.id: note};

  factory InMemoryNotesRepository.seeded() {
    final now = DateTime.now();
    return InMemoryNotesRepository._([
      Note(
        id: 'welcome',
        createdAt: now.subtract(const Duration(minutes: 12)),
        updatedAt: now.subtract(const Duration(minutes: 2)),
        body: '''# Welcome to anotAI

This is a **real editable note**, rendered with live Markdown while you type.

## Try the interaction

- Edit this text like a normal note
- Swipe a note in the list to delete it
- Tap the orange sparkle button to open the AI instruction field

> While that field is open, this note stays scrollable but becomes read-only.

The AI action is intentionally a UI placeholder in this first Flutter slice.''',
      ),
      Note(
        id: 'ideas',
        createdAt: now.subtract(const Duration(days: 2)),
        updatedAt: now.subtract(const Duration(hours: 3)),
        body: '''# Product ideas

- Fast capture from the lock screen
- Local markdown files
- `Obsidian`-style live formatting
- AI edits that are always undoable''',
      ),
    ]);
  }

  final Map<String, Note> _notes;
  int _nextId = 0;

  @override
  Future<Note> create() async {
    final now = DateTime.now();
    final note = Note(
      id: '${now.microsecondsSinceEpoch}-${_nextId++}',
      body: '',
      createdAt: now,
      updatedAt: now,
    );
    _notes[note.id] = note;
    return note;
  }

  @override
  Future<void> delete(String id) async {
    _notes.remove(id);
  }

  @override
  Future<Note?> find(String id) async => _notes[id];

  @override
  Future<List<Note>> list() async {
    final notes = _notes.values.toList(growable: false);
    notes.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return notes;
  }

  @override
  Future<void> save(Note note) async {
    _notes[note.id] = note;
  }
}
