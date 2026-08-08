import 'dart:io';
import 'dart:ui';

import 'file_notes_repository.dart';
import 'note_slug.dart';

/// Functions the transfer service needs from the platform, injected so the
/// service stays testable and views never import plugins.
typedef NoteFilePicker = Future<List<String>> Function();
typedef NoteFileSharer = Future<void> Function(
    List<String> paths, Rect? origin);

/// Imports and exports note files through the system file picker / share sheet,
/// in the same way on every platform.
///
/// Files are always handed across the boundary as plain markdown: an export
/// writes each note's body to a temp copy named after its title (slugified),
/// with **no frontmatter**, and an import adopts every picked file as a new
/// note (the repository writes its own frontmatter). The user never sees the
/// app's metadata block.
class NoteTransfer {
  NoteTransfer({
    required this.notesRepository,
    required this.pickMarkdownFiles,
    required this.shareFiles,
  });

  final FileNotesRepository notesRepository;
  final NoteFilePicker pickMarkdownFiles;
  final NoteFileSharer shareFiles;

  /// The folder the note files live in, shown in Settings.
  String get storagePath => notesRepository.root.path;

  /// Lets the user pick `.md` files and imports them. Returns how many were
  /// imported (for a quick confirmation).
  Future<int> importNotes() async {
    final paths = await pickMarkdownFiles();
    if (paths.isEmpty) return 0;
    return notesRepository.importFiles(paths);
  }

  /// Shares every note as a clean, title-named `.md` copy through the system
  /// share sheet. The temp copies are cleaned up after sharing.
  Future<void> exportAll({Rect? sharePositionOrigin}) async {
    final notes = await notesRepository.list();
    if (notes.isEmpty) return;

    final dir = await Directory.systemTemp.createTemp('anotai-export');
    final usedNames = <String>{};
    final paths = <String>[];
    try {
      for (final note in notes) {
        final name = slugifyTitle(note.title);
        var unique = name;
        for (var suffix = 1; !usedNames.add(unique); suffix++) {
          unique = '$name-$suffix';
        }
        final file = File('${dir.path}${Platform.pathSeparator}$unique.md');
        await file.writeAsString(note.body, flush: true);
        paths.add(file.path);
      }
      await shareFiles(paths, sharePositionOrigin);
    } finally {
      try {
        if (await dir.exists()) {
          await dir.delete(recursive: true);
        }
      } catch (_) {
        // Best-effort cleanup; a stray temp dir is harmless.
      }
    }
  }
}
