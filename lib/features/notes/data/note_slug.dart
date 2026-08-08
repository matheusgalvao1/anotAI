/// Turns a note's title into a filesystem-safe filename stem.
///
/// The result only contains ASCII lowercase letters, digits, and single
/// hyphens, so the same slug is valid everywhere, and it stays deterministic
/// so a retitle produces a stable, recognizable filename.
String slugifyTitle(String title) {
  final slug = title
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'-{2,}'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  var trimmed = slug;
  if (trimmed.length > 50) {
    trimmed = trimmed.substring(0, 50).replaceAll(RegExp(r'-+$'), '');
  }
  return trimmed.isEmpty ? 'note' : trimmed;
}
