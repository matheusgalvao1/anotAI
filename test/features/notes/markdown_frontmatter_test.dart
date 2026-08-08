import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/data/markdown_frontmatter.dart';
import 'package:anotai/features/notes/models/note.dart';

void main() {
  final createdAt = DateTime.utc(2026, 8, 8, 12);
  final updatedAt = DateTime.utc(2026, 8, 8, 12, 5);

  test('round-trips a note through frontmatter', () {
    const body = '# Title\n\nSome **markdown** body.\n';
    final content = serializeFrontmatterFields(
      id: '1786200000000000-0',
      createdAt: createdAt,
      updatedAt: updatedAt,
      body: body,
    );

    final parsed = parseFrontmatter(content);
    expect(parsed, isNotNull);
    expect(parsed!.id, '1786200000000000-0');
    expect(parsed.createdAt, createdAt);
    expect(parsed.updatedAt, updatedAt);
    // The body comes back without the frontmatter block or its blank line.
    expect(parsed.body, body);
  });

  test('serialize uses the note fields', () {
    final note = Note(
      id: 'a-1',
      body: '# Hi',
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
    final content = serializeFrontmatter(note);
    expect(content, startsWith('---\nid: a-1\n'));
    expect(content,
        contains('created_at: ${createdAt.toUtc().toIso8601String()}'));
    expect(content, endsWith('# Hi'));
  });

  test('content without frontmatter parses to null', () {
    expect(parseFrontmatter('# Just a note\n'), isNull);
    expect(parseFrontmatter(''), isNull);
    expect(parseFrontmatter('---\nunterminated'), isNull);
  });

  test('a foreign frontmatter block parses to null', () {
    // Another app's frontmatter (different keys) must not be mistaken for ours.
    const foreign = '---\ntitle: Something\npubDate: 2024-01-01\n---\n\nBody';
    expect(parseFrontmatter(foreign), isNull);
  });

  test('malformed or unsafe ids parse to null', () {
    final content = serializeFrontmatterFields(
      id: '../escape',
      createdAt: createdAt,
      updatedAt: updatedAt,
      body: 'x',
    );
    expect(parseFrontmatter(content), isNull);
  });

  test('missing timestamps parse to null', () {
    expect(parseFrontmatter('---\nid: a-1\n---\n'), isNull);
  });
}
