import 'package:flutter_test/flutter_test.dart';

import 'package:anotai/features/ai/data/agent/note_store.dart';
import 'package:anotai/features/ai/data/agent/tools.dart';

void main() {
  final store = InMemoryNoteStore();

  group('read_note', () {
    setUp(() => store.write('line one\nline two\nline three'));

    test('whole note by default', () {
      final result = executeReadNote(store, const {}) as Map<String, dynamic>;
      expect(result['content'], 'line one\nline two\nline three');
      expect(result['total_lines'], 3);
      expect(result['has_more'], false);
    });

    test('offset and limit page through the note', () {
      final result = executeReadNote(store, const {'offset': 1, 'limit': 1})
          as Map<String, dynamic>;
      expect(result['content'], 'line two');
      expect(result['has_more'], true);
    });

    test('rejects a non-numeric offset', () {
      final result =
          executeReadNote(store, const {'offset': 'x'}) as Map<String, dynamic>;
      expect(result, containsPair('ok', false));
    });
  });

  group('rewrite_note', () {
    test('replaces the entire body', () {
      final result = executeRewriteNote(store, const {'content': 'brand new'})
          as Map<String, dynamic>;
      expect(result, containsPair('ok', true));
      expect(store.read(), 'brand new');
    });

    test('refuses a missing content string', () {
      final result =
          executeRewriteNote(store, const {}) as Map<String, dynamic>;
      expect(result['ok'], false);
      expect(store.read(), isNotEmpty);
    });
  });

  group('patch_note', () {
    setUp(() => store.write('alpha beta alpha\n\n  spaced   words  here'));

    test('applies a unique edit', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'alpha beta', 'new_string': 'A B'}
        ],
      }) as Map<String, dynamic>;
      expect(result, {'ok': true, 'applied': 1});
      expect(store.read(), 'A B alpha\n\n  spaced   words  here');
    });

    test('applies ordered edits atomically in one write', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'alpha beta', 'new_string': 'A B'},
          {'old_string': 'alpha', 'new_string': 'second'},
        ],
      }) as Map<String, dynamic>;
      expect(result['ok'], true);
      expect(store.read(), 'A B second\n\n  spaced   words  here');
    });

    test('replace_all swaps every occurrence', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'alpha', 'new_string': 'x', 'replace_all': true},
        ],
      }) as Map<String, dynamic>;
      expect(result['ok'], true);
      expect(store.read(), 'x beta x\n\n  spaced   words  here');
    });

    test('falls back to whitespace-normalized matching', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'spaced words', 'new_string': 'condensed'},
        ],
      }) as Map<String, dynamic>;
      expect(result['ok'], true);
      expect(store.read(), 'alpha beta alpha\n\n  condensed  here');
    });

    test('reports an ambiguous match instead of guessing', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'alpha', 'new_string': 'x'},
        ],
      }) as Map<String, dynamic>;
      expect(result['ok'], false);
      expect(result['error'], contains('matches 2 locations'));
      expect(store.read(), 'alpha beta alpha\n\n  spaced   words  here');
    });

    test('a failed edit stops the batch and reports its index', () {
      final result = executePatchNote(store, {
        'edits': [
          {'old_string': 'alpha beta', 'new_string': 'A B'},
          {'old_string': 'does not exist', 'new_string': 'y'},
        ],
      }) as Map<String, dynamic>;
      expect(result['ok'], false);
      expect(result['failed_index'], 1);
      expect(store.read(), 'alpha beta alpha\n\n  spaced   words  here');
    });

    test('requires at least one edit', () {
      final result = executePatchNote(store, {
        'edits': <Map<String, dynamic>>[],
      }) as Map<String, dynamic>;
      expect(result['ok'], false);
    });
  });

  test('schemas stay tool-shaped for OpenAI-wire purposes', () {
    final json = rewriteNoteSchema.parameters;
    expect(json['required'], contains('content'));
    expect(readNoteSchema.parameters['properties'], isA<Map>());
  });
}
