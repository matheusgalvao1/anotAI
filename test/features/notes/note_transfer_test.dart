import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/data/file_notes_repository.dart';
import 'package:anotai/features/notes/data/note_transfer.dart';

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('anotai-transfer-test');
  });

  tearDown(() async {
    if (await root.exists()) {
      await root.delete(recursive: true);
    }
  });

  test('exportAll shares clean, title-named copies with no frontmatter',
      () async {
    final repo = FileNotesRepository(root);
    final first = await repo.create();
    await repo.save(first.copyWith(
      body: '# Grocery List\n\nApples\nMilk',
      updatedAt: DateTime.now(),
    ));
    final second = await repo.create();
    await repo.save(second.copyWith(
      body: '# Ideas\n\n- one\n- two',
      updatedAt: DateTime.now(),
    ));

    final shared = <String>[];
    final capturedContent = <String, String>{};
    final transfer = NoteTransfer(
      notesRepository: repo,
      pickMarkdownFiles: () async => const [],
      shareFiles: (paths, origin) async {
        shared.addAll(paths);
        for (final path in paths) {
          capturedContent[path] = await File(path).readAsString();
        }
      },
    );

    await transfer.exportAll(
        sharePositionOrigin: const Rect.fromLTWH(0, 0, 1, 1));

    expect(shared, hasLength(2));
    final names = shared
        .map((p) => p.split(Platform.pathSeparator).last)
        .toList()
      ..sort();
    expect(names, ['grocery-list.md', 'ideas.md']);

    // What the user receives is clean content: no frontmatter block.
    for (final content in capturedContent.values) {
      expect(content.startsWith('---'), isFalse,
          reason: 'no frontmatter in exports');
    }
    final grocery = shared.firstWhere((p) => p.endsWith('grocery-list.md'));
    expect(capturedContent[grocery], '# Grocery List\n\nApples\nMilk');

    // Copies were cleaned up after sharing.
    for (final path in shared) {
      expect(await File(path).exists(), isFalse);
    }
  });

  test('exportAll suffixes duplicate titles', () async {
    final repo = FileNotesRepository(root);
    final notes = [
      await repo.create(),
      await repo.create(),
      await repo.create(),
    ];
    for (final note in notes) {
      await repo.save(note.copyWith(
        body: '# Project\nMaybe a title later',
        updatedAt: DateTime.now(),
      ));
    }

    final names = <String>[];
    final transfer = NoteTransfer(
      notesRepository: repo,
      pickMarkdownFiles: () async => const [],
      shareFiles: (paths, origin) async => names.addAll(paths),
    );
    await transfer.exportAll();

    expect(names, hasLength(3));
    expect(names.map((p) => p.split('/').last).toSet(), {
      'project.md',
      'project-1.md',
      'project-2.md',
    });
  });

  test('exportAll with no notes shares nothing', () async {
    final repo = FileNotesRepository(root);
    var shared = false;
    final transfer = NoteTransfer(
      notesRepository: repo,
      pickMarkdownFiles: () async => const [],
      shareFiles: (paths, origin) async => shared = true,
    );
    await transfer.exportAll();
    expect(shared, isFalse);
  });
}
