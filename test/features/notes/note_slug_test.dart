import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/data/note_slug.dart';

void main() {
  test('lowercases and hyphenates', () {
    expect(slugifyTitle('Grocery List'), 'grocery-list');
    expect(slugifyTitle('  My   Plans  '), 'my-plans');
  });

  test('strips punctuation and non-ascii', () {
    expect(slugifyTitle('Café!? Notes — 2026'), 'caf-notes-2026');
    expect(slugifyTitle('TODO: (ship) it'), 'todo-ship-it');
  });

  test('collapses and trims hyphens', () {
    expect(slugifyTitle('- leading and trailing -'), 'leading-and-trailing');
  });

  test('caps length', () {
    final slug = slugifyTitle('a ' * 60);
    expect(slug.length, lessThanOrEqualTo(50));
    expect(slug.endsWith('-'), isFalse);
  });

  test('falls back when nothing usable remains', () {
    expect(slugifyTitle('!!!'), 'note');
    expect(slugifyTitle(''), 'note');
  });
}
