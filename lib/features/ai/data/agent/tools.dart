import 'config.dart';
import 'note_store.dart';
import 'types.dart';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const readNoteSchema = ToolSchema(
  name: 'read_note',
  description:
      'Read the current note content, optionally a line range. Returns raw text with no line-number prefixes.',
  parameters: {
    'type': 'object',
    'properties': {
      'offset': {
        'type': 'number',
        'description': '0-based starting line, default 0'
      },
      'limit': {
        'type': 'number',
        'description': 'number of lines to return, default 500'
      },
    },
  },
);

const rewriteNoteSchema = ToolSchema(
  name: 'rewrite_note',
  description:
      'Replace the entire note body. Use for structural changes, format changes, or when more than roughly half the note changes.',
  parameters: {
    'type': 'object',
    'properties': {
      'content': {
        'type': 'string',
        'description': 'the full new markdown body'
      },
    },
    'required': ['content'],
  },
);

const patchNoteSchema = ToolSchema(
  name: 'patch_note',
  description:
      "Apply one or more targeted find/replace edits, in order, atomically. Use for localized changes. old_string must match the note exactly, or be unique after whitespace normalization.",
  parameters: {
    'type': 'object',
    'properties': {
      'edits': {
        'type': 'array',
        'description': 'edits to apply in order',
        'items': {
          'type': 'object',
          'properties': {
            'old_string': {'type': 'string'},
            'new_string': {'type': 'string'},
            'replace_all': {
              'type': 'boolean',
              'description':
                  'replace every occurrence instead of requiring a unique match, default false',
            },
          },
          'required': ['old_string', 'new_string'],
        },
      },
    },
    'required': ['edits'],
  },
);

/// The tools that can change the note, so the loop only rounds-trips storage
/// around them.
const writeToolNames = {'rewrite_note', 'patch_note'};

// ---------------------------------------------------------------------------
// Argument validation + executors
// ---------------------------------------------------------------------------

/// Tool arguments arrive as whatever the model streamed, parsed leniently — a
/// truncated or malformed tool call yields `{}`, never the declared shape. So
/// every executor validates before touching the note. A bad argument must come
/// back as a tool error the model can recover from on the next iteration,
/// never as a thrown exception and never as a write of garbage into the note.
String? _argString(Map<String, dynamic> args, String key) {
  final value = args[key];
  return value is String ? value : null;
}

num? _argNumber(Map<String, dynamic> args, String key) {
  final value = args[key];
  if (value is num) return value;
  if (value is String) return double.tryParse(value);
  return null;
}

bool? _argBool(Map<String, dynamic> args, String key) {
  final value = args[key];
  if (value is bool) return value;
  if (value is String && (value == 'true' || value == 'false')) {
    return value == 'true';
  }
  return null;
}

// ---------------------------------------------------------------------------
// read_note
// ---------------------------------------------------------------------------

Object executeReadNote(NoteStore store, Map<String, dynamic> args) {
  final offsetValue = _argNumber(args, 'offset');
  if (offsetValue == null && args.containsKey('offset')) {
    return {'ok': false, 'error': 'offset must be a number.'};
  }
  final limitValue = _argNumber(args, 'limit');
  if (limitValue == null && args.containsKey('limit')) {
    return {'ok': false, 'error': 'limit must be a number.'};
  }

  final lines = store.read().split('\n');
  final offset = (offsetValue ?? 0).toInt().clamp(0, 1 << 31);
  final limit = (limitValue ?? AgentConfig.readNoteDefaultLimitLines)
      .toInt()
      .clamp(0, 1 << 31);
  final slice = lines.skip(offset).take(limit).toList(growable: false);
  return {
    'content': slice.join('\n'),
    'total_lines': lines.length,
    'has_more': offset + limit < lines.length,
  };
}

// ---------------------------------------------------------------------------
// rewrite_note
// ---------------------------------------------------------------------------

Object executeRewriteNote(NoteStore store, Map<String, dynamic> args) {
  final content = _argString(args, 'content');
  if (content == null) {
    return {
      'ok': false,
      'error':
          'rewrite_note requires a `content` string holding the full new note body. Nothing was written.',
    };
  }
  store.write(content);
  return {'ok': true, 'bytes': utf8ByteLength(content)};
}

int utf8ByteLength(String value) {
  // No dart:convert dependency for a guardrail count: code units are a fine
  // stable upper bound for the 2MiB note cap.
  return value.length * 2;
}

// ---------------------------------------------------------------------------
// patch_note
// ---------------------------------------------------------------------------

const _retryHint =
    'Try read_note to see the current content, then use rewrite_note instead.';

Object executePatchNote(NoteStore store, Map<String, dynamic> args) {
  final rawEdits = args['edits'];
  if (rawEdits is! List) {
    return {
      'ok': false,
      'error':
          'patch_note requires an `edits` array of {old_string, new_string} objects. Nothing was written.',
    };
  }
  if (rawEdits.isEmpty) {
    return {
      'ok': false,
      'error': 'patch_note requires at least one edit. Nothing was written.'
    };
  }

  final edits = <_PatchEdit>[];
  for (var i = 0; i < rawEdits.length; i++) {
    final parsed = _parseEdit(rawEdits[i], i);
    if (parsed.parsed == null) {
      return {'ok': false, 'error': '${parsed.error} Nothing was written.'};
    }
    edits.add(parsed.parsed!);
  }

  var content = store.read();
  for (var i = 0; i < edits.length; i++) {
    final result = _applyEdit(content, edits[i]);
    if (result.errorMessage != null) {
      return {
        'ok': false,
        'error': '${result.errorMessage} $_retryHint',
        'failed_index': i
      };
    }
    content = result.content;
  }

  store.write(content);
  return {'ok': true, 'applied': edits.length};
}

class _ParsedEdit {
  const _ParsedEdit(this.parsed, this.error);
  final _PatchEdit? parsed;
  final String? error;
}

_ParsedEdit _parseEdit(Object? value, int index) {
  if (value is! Map<String, dynamic>) {
    return _ParsedEdit(null,
        'edits[$index] must be an object with old_string and new_string.');
  }
  final oldString = _argString(value, 'old_string');
  if (oldString == null) {
    return _ParsedEdit(null, 'edits[$index].old_string must be a string.');
  }
  final newString = _argString(value, 'new_string');
  if (newString == null) {
    return _ParsedEdit(null, 'edits[$index].new_string must be a string.');
  }
  final replaceAll = _argBool(value, 'replace_all');
  if (replaceAll == null && value.containsKey('replace_all')) {
    return _ParsedEdit(
        null, 'edits[$index].replace_all must be a boolean when present.');
  }
  return _ParsedEdit(
    _PatchEdit(
        oldString: oldString,
        newString: newString,
        replaceAll: replaceAll ?? false),
    null,
  );
}

class _PatchEdit {
  const _PatchEdit(
      {required this.oldString,
      required this.newString,
      required this.replaceAll});
  final String oldString;
  final String newString;
  final bool replaceAll;
}

class _ApplyResult {
  const _ApplyResult({required this.content, this.errorMessage});
  final String content;
  final String? errorMessage;
}

_ApplyResult _applyEdit(String content, _PatchEdit edit) {
  final oldString = edit.oldString;
  final newString = edit.newString;

  if (oldString.isEmpty) {
    return _ApplyResult(
        content: content, errorMessage: 'old_string must not be empty.');
  }

  final exactCount = _countOccurrences(content, oldString);
  if (exactCount > 0) {
    if (exactCount > 1 && !edit.replaceAll) {
      return _ApplyResult(
        content: content,
        errorMessage:
            'old_string matches $exactCount locations in the note; add more surrounding context to make it unique, or set replace_all.',
      );
    }
    return _ApplyResult(
      content: edit.replaceAll
          ? content.split(oldString).join(newString)
          : content.replaceFirst(oldString, newString),
    );
  }

  // Exact match failed — fall back to whitespace-normalized matching. This is
  // as far as v1 goes deliberately: anything looser risks guessing wrong,
  // which is worse than surfacing an error the model can recover from.
  final normalizedNeedle = _normalizeWhitespace(oldString);
  final matches = _findNormalizedMatches(content, normalizedNeedle);

  if (matches.isEmpty) {
    return _ApplyResult(
      content: content,
      errorMessage:
          'old_string was not found in the note (even ignoring whitespace differences).',
    );
  }
  if (matches.length > 1 && !edit.replaceAll) {
    return _ApplyResult(
      content: content,
      errorMessage:
          'old_string matches ${matches.length} locations after ignoring whitespace differences; add more surrounding context, or set replace_all.',
    );
  }

  final toReplace = edit.replaceAll ? matches : [matches.first];
  var result = content;
  for (final span in [...toReplace]
    ..sort((a, b) => b.start.compareTo(a.start))) {
    result = result.replaceRange(span.start, span.end, newString);
  }
  return _ApplyResult(content: result);
}

int _countOccurrences(String haystack, String needle) {
  var count = 0;
  var idx = 0;
  while (true) {
    final found = haystack.indexOf(needle, idx);
    if (found == -1) break;
    count++;
    idx = found + needle.length;
  }
  return count;
}

String _normalizeWhitespace(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ');

class _Span {
  const _Span(this.start, this.end);
  final int start;
  final int end;
}

/// Builds a whitespace-collapsed view of `content` alongside maps back to
/// original offsets, so a match found in the collapsed string can be applied
/// as a precise splice against the original text.
({String normalized, List<int> starts, List<int> ends}) _buildNormalizedIndex(
    String content) {
  final normalized = StringBuffer();
  final starts = <int>[];
  final ends = <int>[];
  var i = 0;
  final n = content.length;

  while (i < n) {
    if (RegExp(r'\s').hasMatch(content[i])) {
      final runStart = i;
      while (i < n && RegExp(r'\s').hasMatch(content[i])) {
        i++;
      }
      normalized.write(' ');
      starts.add(runStart);
      ends.add(i);
    } else {
      normalized.write(content[i]);
      starts.add(i);
      ends.add(i + 1);
      i++;
    }
  }

  return (normalized: normalized.toString(), starts: starts, ends: ends);
}

List<_Span> _findNormalizedMatches(String content, String normalizedNeedle) {
  if (normalizedNeedle.isEmpty) return const [];

  final index = _buildNormalizedIndex(content);
  final matches = <_Span>[];
  var fromIndex = 0;

  while (true) {
    final idx = index.normalized.indexOf(normalizedNeedle, fromIndex);
    if (idx == -1) break;
    final matchEndIdx = idx + normalizedNeedle.length - 1;
    matches.add(_Span(index.starts[idx], index.ends[matchEndIdx]));
    fromIndex = idx + 1;
  }

  return matches;
}
