import 'dart:io';

import '../models/note.dart';
import 'markdown_frontmatter.dart';
import 'notes_repository.dart';

/// A `NotesRepository` that stores each note as a markdown file under a root
/// directory: `<root>/<id>.md` with the app's frontmatter block on top.
///
/// The id is the note's identity — it lives in the frontmatter and the
/// filename, and it never changes when the note is retitled, so editing the
/// first line of a note never moves its file. The friendly slug is purely an
/// export concern (see `note_transfer.dart`); internally, names stay opaque
/// and stable.
///
/// Notes are real, portable files, so the repository degrades gracefully when
/// a file is moved, renamed, or edited in the OS: lookups fall back to a
/// frontmatter scan, foreign `.md` files still load with a filename-derived
/// id, and writes are atomic (temp file + rename) so a crash mid-save cannot
/// corrupt a note. Deletes are permanent.
class FileNotesRepository implements NotesRepository {
  FileNotesRepository(this.root);

  static const _extension = '.md';

  final Directory root;

  int _nextId = 0;

  Future<void> _ensureReady() async {
    if (!await root.exists()) {
      await root.create(recursive: true);
    }
  }

  File _fileFor(String id) =>
      File('${root.path}${Platform.pathSeparator}$id$_extension');

  /// Copies picked markdown files into the note store.
  ///
  /// Exports never carry the app's frontmatter (see `note_transfer.dart`), so
  /// every imported file is adopted as a brand-new note: its whole content
  /// becomes the body and the app writes its own frontmatter. Returns how many
  /// files were imported.
  Future<int> importFiles(List<String> paths) async {
    await _ensureReady();
    var imported = 0;
    for (final path in paths) {
      final source = File(path);
      if (!await source.exists()) continue;

      String content;
      try {
        content = await source.readAsString();
      } catch (_) {
        continue;
      }

      final now = DateTime.now();
      final note =
          Note(id: _newId(now), body: content, createdAt: now, updatedAt: now);
      await _atomicWrite(_fileFor(note.id), serializeFrontmatter(note));
      imported++;
    }
    return imported;
  }

  @override
  Future<List<Note>> list() async {
    await _ensureReady();
    final notes = <Note>[];
    await for (final entity in root.list(followLinks: false)) {
      if (entity is! File) continue;
      if (!entity.path.endsWith(_extension)) continue;
      final note = await _readNoteFile(entity);
      if (note != null) notes.add(note);
    }
    notes.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return notes;
  }

  @override
  Future<Note?> find(String id) async {
    final file = await _locateFile(id);
    if (file == null) return null;
    return _readNoteFile(file);
  }

  /// Resolves the file backing a note by its frontmatter id. The conventional
  /// `<id>.md` path first, then — because a user may have renamed the file in
  /// the OS — a scan for the id in the frontmatter, so find/save/delete never
  /// drift from what list() reports.
  Future<File?> _locateFile(String id) async {
    final direct = _fileFor(id);
    if (await direct.exists()) return direct;
    if (!await root.exists()) return null;
    await for (final entity in root.list(followLinks: false)) {
      if (entity is! File || !entity.path.endsWith(_extension)) continue;
      final note = await _readNoteFile(entity);
      if (note != null && note.id == id) return entity;
    }
    return null;
  }

  Future<Note?> _readNoteFile(File file) async {
    try {
      final content = await file.readAsString();
      final frontmatter = parseFrontmatter(content);
      final stat = await file.stat();
      if (frontmatter != null) {
        return Note(
          id: frontmatter.id,
          body: frontmatter.body,
          createdAt: frontmatter.createdAt,
          updatedAt: frontmatter.updatedAt,
        );
      }
      // Foreign or externally-edited file without frontmatter: derive metadata
      // from the filename and file mtime so it still shows up as a note.
      return Note(
        id: _idFromFileName(file),
        body: content,
        createdAt: stat.modified,
        updatedAt: stat.modified,
      );
    } catch (_) {
      // An unreadable or binary file is skipped rather than failing the list.
      return null;
    }
  }

  @override
  Future<Note> create() async {
    await _ensureReady();
    final now = DateTime.now();
    final note =
        Note(id: _newId(now), body: '', createdAt: now, updatedAt: now);
    await _atomicWrite(_fileFor(note.id), serializeFrontmatter(note));
    return note;
  }

  @override
  Future<void> save(Note note) async {
    await _ensureReady();
    // Locate first so a note whose file the user renamed in the OS is still
    // written in place instead of silently creating a duplicate.
    final file = await _locateFile(note.id) ?? _fileFor(note.id);
    await _atomicWrite(file, serializeFrontmatter(note));
  }

  @override
  Future<void> delete(String id) async {
    final file = await _locateFile(id);
    if (file != null && await file.exists()) {
      await file.delete();
    }
  }

  String _newId(DateTime now) => '${now.microsecondsSinceEpoch}-${_nextId++}';

  String _idFromFileName(File file) {
    final name = file.uri.pathSegments.last;
    return name.endsWith(_extension)
        ? name.substring(0, name.length - _extension.length)
        : name;
  }

  /// Writes [content] to a temp file next to [target], then renames over it.
  /// Same-directory rename is atomic on the filesystems both platforms use, so
  /// a crash can never leave a half-written note behind.
  Future<void> _atomicWrite(File target, String content) async {
    final tmp = File('${target.path}.tmp');
    await tmp.writeAsString(content, flush: true);
    await tmp.rename(target.path);
  }
}
