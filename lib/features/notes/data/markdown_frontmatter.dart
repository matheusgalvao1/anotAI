import '../models/note.dart';

/// The metadata block a note file carries above its markdown body:
///
/// ```markdown
/// ---
/// id: 1786200000000000-0
/// created_at: 2026-08-08T12:00:00.000Z
/// updated_at: 2026-08-08T12:05:00.000Z
/// ---
/// ```
///
/// The format is deliberately tiny and app-owned (no YAML dependency). A file
/// edited externally — or a foreign `.md` dropped in via import — may omit it
/// entirely; callers fall back to filename/mtime when parsing returns null.
class FrontmatterFields {
  const FrontmatterFields({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    required this.body,
  });

  final String id;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// The markdown below the frontmatter block (the note's editable body).
  final String body;
}

/// Parses the leading frontmatter of note content.
///
/// Returns null when the content does not begin with a `---` line or the block
/// is missing/contains a malformed required field. Being strict here matters:
/// import uses a null result to decide "foreign file → new note" instead of
/// "our file → restore by id".
FrontmatterFields? parseFrontmatter(String content) {
  if (!content.startsWith('---\n')) return null;
  final newlineAfterStart = content.indexOf('\n');
  if (newlineAfterStart == -1) return null;

  final rest = content.substring(newlineAfterStart + 1);
  final endMarker = rest.indexOf('\n---\n');
  if (endMarker == -1) return null;

  final rawFields = rest.substring(0, endMarker);
  var body = rest.substring(endMarker + '\n---\n'.length);
  // Our serializer writes exactly one blank line between the block and the
  // body; drop it so a round trip is stable against the leading-newline drift
  // a first naive parse would introduce. Files formatted differently only ever
  // reach this branch when they are ours.
  if (body.startsWith('\n')) {
    body = body.substring(1);
  }

  final fields = <String, String>{};
  for (final line in rawFields.split('\n')) {
    if (line.isEmpty) continue;
    final colon = line.indexOf(':');
    if (colon <= 0) continue;
    final key = line.substring(0, colon).trim();
    final value = line.substring(colon + 1).trim();
    if (key.isEmpty || value.isEmpty) continue;
    fields[key] = value;
  }

  final id = fields['id'];
  if (id == null || id.isEmpty || !_safeId(id)) return null;
  final createdAt = _parseTimestamp(fields['created_at']);
  final updatedAt = _parseTimestamp(fields['updated_at']);
  if (createdAt == null || updatedAt == null) return null;

  return FrontmatterFields(
    id: id,
    createdAt: createdAt,
    updatedAt: updatedAt,
    body: body,
  );
}

/// Serializes a note (metadata + body) into file contents.
String serializeFrontmatter(Note note) => serializeFrontmatterFields(
      id: note.id,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      body: note.body,
    );

String serializeFrontmatterFields({
  required String id,
  required DateTime createdAt,
  required DateTime updatedAt,
  required String body,
}) =>
    '---\n'
    'id: $id\n'
    'created_at: ${_formatTimestamp(createdAt)}\n'
    'updated_at: ${_formatTimestamp(updatedAt)}\n'
    '---\n'
    '\n'
    '$body';

/// A note id doubles as a filename, so it must never be able to escape the
/// notes directory (no slashes, no `.`/`..`), and it should be ASCII-safe.
bool _safeId(String id) {
  if (id.isEmpty || id.length > 120) return false;
  if (id.contains('/') || id.contains('\\')) return false;
  if (id == '.' || id == '..') return false;
  return id.codeUnits.every((unit) => unit < 128);
}

DateTime? _parseTimestamp(String? raw) {
  if (raw == null || raw.isEmpty) return null;
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return null;
  if (parsed.isUtc) return parsed;
  return parsed.toUtc();
}

String _formatTimestamp(DateTime value) => value.toUtc().toIso8601String();
