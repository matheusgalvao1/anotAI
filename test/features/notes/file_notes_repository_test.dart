import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/data/file_notes_repository.dart';
import 'package:anotai/features/notes/data/markdown_frontmatter.dart';

void main() {
  late Directory root;

  setUp(() async {
    root = await Directory.systemTemp.createTemp('anotai-notes-test');
  });

  tearDown(() async {
    if (await root.exists()) {
      await root.delete(recursive: true);
    }
  });

  FileNotesRepository repository() => FileNotesRepository(root);

  File fileFor(String id) =>
      File('${root.path}${Platform.pathSeparator}$id.md');

  test('create writes an id-named file that find can read back', () async {
    final repo = repository();
    final note = await repo.create();

    expect(await fileFor(note.id).exists(), isTrue);
    expect(parseFrontmatter(await fileFor(note.id).readAsString()), isNotNull);

    final found = await repo.find(note.id);
    expect(found, isNotNull);
    expect(found!.id, note.id);
    expect(found.body, note.body);
  });

  test('save persists body, bumps updated_at, and keeps one file', () async {
    final repo = repository();
    final note = await repo.create();
    final earlier = note.updatedAt;

    final saved = note.copyWith(
      body: '# Real body\n\nSome content.',
      updatedAt: DateTime.now().add(const Duration(seconds: 1)),
    );
    await repo.save(saved);

    final found = await repo.find(note.id);
    expect(found!.body, '# Real body\n\nSome content.');
    expect(found.updatedAt.isAfter(earlier), isTrue);
    expect(found.createdAt.isAtSameMomentAs(note.createdAt), isTrue);

    // Retitling does not rename the file — the id owns the name.
    expect(await fileFor(note.id).exists(), isTrue);
    final fileNames = root
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.md'))
        .toList();
    expect(fileNames, hasLength(1));
  });

  test('atomic write leaves no temp file behind', () async {
    final repo = repository();
    final note = await repo.create();
    await repo.save(note.copyWith(body: '# x\n', updatedAt: DateTime.now()));

    expect(
        root.listSync().whereType<File>().any((f) => f.path.endsWith('.tmp')),
        isFalse);
  });

  test('list() is ordered by updated_at descending', () async {
    final repo = repository();
    final first = await repo.create();
    await repo.save(first.copyWith(
      body: '# First\n',
      updatedAt: DateTime.now().add(const Duration(seconds: 1)),
    ));
    await Future<void>.delayed(const Duration(milliseconds: 2));
    final second = await repo.create();

    final notes = await repo.list();
    expect(notes.map((n) => n.id).toList(), [first.id, second.id]);
  });

  test('a file without frontmatter still shows up', () async {
    final repo = repository();
    final file = File('${root.path}${Platform.pathSeparator}12345-0.md');
    await file.writeAsString('# Foreign note\nNo frontmatter here.');

    final notes = await repo.list();
    expect(notes, hasLength(1));
    expect(notes.first.id, '12345-0');
    expect(notes.first.body, '# Foreign note\nNo frontmatter here.');
  });

  test('non-markdown files are skipped', () async {
    final repo = repository();
    await repo.create();
    await File('${root.path}${Platform.pathSeparator}readme.txt')
        .writeAsString('plain');

    expect(await repo.list(), hasLength(1));
  });

  test('delete hard-deletes the file', () async {
    final repo = repository();
    final note = await repo.create();
    await repo.delete(note.id);

    expect(await repo.find(note.id), isNull);
    expect(await fileFor(note.id).exists(), isFalse);
  });

  test('delete of a missing note is a no-op', () async {
    final repo = repository();
    await repo.delete('never-existed');
  });

  test('importFiles adopts every file as a new note with app frontmatter',
      () async {
    final repo = repository();
    final dir = await Directory.systemTemp.createTemp('anotai-import');
    addTearDown(() => dir.delete(recursive: true));
    final first = File('${dir.path}${Platform.pathSeparator}a.md')
      ..writeAsStringSync('# Alpha\nOne');
    final second = File('${dir.path}${Platform.pathSeparator}b.md')
      ..writeAsStringSync('# Beta\nTwo');

    final imported = await repo.importFiles([first.path, second.path]);
    expect(imported, 2);

    final notes = await repo.list();
    expect(notes, hasLength(2));
    final byBody = {for (final n in notes) n.body: n};
    expect(byBody['# Alpha\nOne'], isNotNull);
    expect(byBody['# Beta\nTwo'], isNotNull);
    // Their ids are new and distinct, and each file gained our frontmatter.
    expect(byBody['# Alpha\nOne']!.id, isNot(byBody['# Beta\nTwo']!.id));
    expect(
      parseFrontmatter(
          await fileFor(byBody['# Alpha\nOne']!.id).readAsString()),
      isNotNull,
    );
  });

  test('a note renamed in the files app keeps its id', () async {
    final repo = repository();
    final note = await repo.create();
    final origId = note.id;
    await fileFor(origId)
        .rename('${root.path}${Platform.pathSeparator}renamed-by-user.md');

    final found = await repo.find(origId);
    expect(found, isNotNull);
    expect(found!.id, origId);

    // Saving still writes through to the renamed file, not a duplicate.
    await repo
        .save(found.copyWith(body: '# Updated\n', updatedAt: DateTime.now()));
    final renamed =
        File('${root.path}${Platform.pathSeparator}renamed-by-user.md');
    expect(renamed.readAsStringSync(), contains('# Updated'));
    expect(mdFiles(root), hasLength(1));

    await repo.delete(origId);
    expect(await repo.find(origId), isNull);
  });
}

List<String> mdFiles(Directory root) => root
    .listSync()
    .whereType<File>()
    .where((file) => file.path.endsWith('.md'))
    .map((file) => file.uri.pathSegments.last)
    .toList();
