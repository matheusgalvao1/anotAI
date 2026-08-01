class Note {
  const Note({
    required this.id,
    required this.body,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String body;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get title {
    for (final line in body.split('\n')) {
      final cleaned = _plainText(line).trim();
      if (cleaned.isNotEmpty) return cleaned;
    }
    return 'New Note';
  }

  String get preview {
    final meaningful = body
        .split('\n')
        .map(_plainText)
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList(growable: false);
    if (meaningful.length < 2) return '';
    return meaningful.skip(1).join(' ');
  }

  Note copyWith({String? body, DateTime? updatedAt}) => Note(
        id: id,
        body: body ?? this.body,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );

  static String _plainText(String value) => value
      .replaceFirst(RegExp(r'^\s{0,3}#{1,6}\s+'), '')
      .replaceFirst(RegExp(r'^\s*(?:[-*+]|\d+\.)\s+'), '')
      .replaceFirst(RegExp(r'^\s*>\s?'), '')
      .replaceAllMapped(
        RegExp(r'\[([^\]]+)\]\([^\)]+\)'),
        (match) => match.group(1)!,
      )
      .replaceAll(RegExp(r'[*_~`]'), '');
}
