import 'package:flutter/material.dart';

class MarkdownPalette {
  const MarkdownPalette({
    required this.text,
    required this.muted,
    required this.accent,
    required this.codeBackground,
  });

  factory MarkdownPalette.of(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return MarkdownPalette(
      text: colors.onSurface,
      muted: colors.onSurfaceVariant.withValues(alpha: 0.62),
      accent: colors.primary,
      codeBackground: colors.surfaceContainerHighest.withValues(alpha: 0.7),
    );
  }

  final Color text;
  final Color muted;
  final Color accent;
  final Color codeBackground;

  @override
  bool operator ==(Object other) =>
      other is MarkdownPalette &&
      other.text == text &&
      other.muted == muted &&
      other.accent == accent &&
      other.codeBackground == codeBackground;

  @override
  int get hashCode => Object.hash(text, muted, accent, codeBackground);
}

/// Paints Markdown in-place. The text, selection, cursor offsets, and value
/// sent to storage remain raw Markdown; only the visual spans change.
class MarkdownEditingController extends TextEditingController {
  MarkdownEditingController(
      {required String text, required MarkdownPalette palette})
      : _palette = palette,
        super(text: text);

  MarkdownPalette _palette;

  void updatePalette(MarkdownPalette palette) {
    if (_palette == palette) return;
    _palette = palette;
    notifyListeners();
  }

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final baseStyle =
        (style ?? const TextStyle()).copyWith(color: _palette.text);
    final composing = value.composing;

    // Keep IME composition completely conventional. Markdown styling returns
    // as soon as the platform commits the composed text.
    if (withComposing &&
        composing.isValid &&
        !composing.isCollapsed &&
        composing.end <= text.length) {
      return TextSpan(
        style: baseStyle,
        children: [
          TextSpan(text: text.substring(0, composing.start)),
          TextSpan(
            text: text.substring(composing.start, composing.end),
            style: const TextStyle(decoration: TextDecoration.underline),
          ),
          TextSpan(text: text.substring(composing.end)),
        ],
      );
    }

    return buildMarkdownTextSpan(
      text: text,
      baseStyle: baseStyle,
      palette: _palette,
    );
  }
}

TextSpan buildMarkdownTextSpan({
  required String text,
  required TextStyle baseStyle,
  required MarkdownPalette palette,
}) {
  final children = <InlineSpan>[];
  final lines = text.split('\n');
  var inFence = false;

  for (var index = 0; index < lines.length; index++) {
    final line = lines[index];
    final fence = RegExp(r'^\s*```').hasMatch(line);

    if (fence) {
      children.add(TextSpan(
        text: line,
        style: baseStyle.copyWith(
          color: palette.muted,
          fontFamily: 'monospace',
          backgroundColor: palette.codeBackground,
        ),
      ));
      inFence = !inFence;
    } else if (inFence) {
      children.add(TextSpan(
        text: line,
        style: baseStyle.copyWith(
          fontFamily: 'monospace',
          backgroundColor: palette.codeBackground,
        ),
      ));
    } else {
      _appendMarkdownLine(children, line, baseStyle, palette);
    }

    if (index != lines.length - 1) children.add(const TextSpan(text: '\n'));
  }

  return TextSpan(style: baseStyle, children: children);
}

void _appendMarkdownLine(
  List<InlineSpan> output,
  String line,
  TextStyle base,
  MarkdownPalette palette,
) {
  final heading = RegExp(r'^(\s{0,3})(#{1,6})(\s+)(.*)$').firstMatch(line);
  if (heading != null) {
    final level = heading.group(2)!.length;
    final headingStyle = base.copyWith(
      fontSize: switch (level) { 1 => 28, 2 => 23, _ => 19 },
      height: 1.28,
      fontWeight: FontWeight.w700,
    );
    output
      ..add(TextSpan(text: heading.group(1), style: headingStyle))
      ..add(TextSpan(
        text: '${heading.group(2)}${heading.group(3)}',
        style: headingStyle.copyWith(color: palette.muted),
      ));
    _appendInline(output, heading.group(4)!, headingStyle, palette);
    return;
  }

  final quote = RegExp(r'^(\s*>\s?)(.*)$').firstMatch(line);
  if (quote != null) {
    output.add(TextSpan(
      text: quote.group(1),
      style: base.copyWith(color: palette.accent, fontWeight: FontWeight.w700),
    ));
    _appendInline(
      output,
      quote.group(2)!,
      base.copyWith(color: palette.muted, fontStyle: FontStyle.italic),
      palette,
    );
    return;
  }

  final list = RegExp(r'^(\s*(?:(?:[-*+]\s+\[[ xX]\])|[-*+]|\d+\.)\s+)(.*)$')
      .firstMatch(line);
  if (list != null) {
    output.add(TextSpan(
      text: list.group(1),
      style: base.copyWith(color: palette.accent, fontWeight: FontWeight.w600),
    ));
    _appendInline(output, list.group(2)!, base, palette);
    return;
  }

  if (RegExp(r'^\s*(?:---+|___+|\*\*\*+)\s*$').hasMatch(line)) {
    output
        .add(TextSpan(text: line, style: base.copyWith(color: palette.muted)));
    return;
  }

  _appendInline(output, line, base, palette);
}

enum _InlineKind { bold, italic, strike, code, link }

final _inlinePatterns = <(_InlineKind, RegExp)>[
  (_InlineKind.bold, RegExp(r'\*\*[^*\n]+\*\*')),
  (_InlineKind.strike, RegExp(r'~~[^~\n]+~~')),
  (_InlineKind.code, RegExp(r'`[^`\n]+`')),
  (_InlineKind.link, RegExp(r'\[[^\]\n]+\]\([^\)\n]+\)')),
  (_InlineKind.italic, RegExp(r'(?<!\*)\*[^*\n]+\*(?!\*)')),
];

void _appendInline(
  List<InlineSpan> output,
  String value,
  TextStyle base,
  MarkdownPalette palette,
) {
  var cursor = 0;
  while (cursor < value.length) {
    _InlineMatch? next;
    for (final (kind, pattern) in _inlinePatterns) {
      final match = pattern.firstMatch(value.substring(cursor));
      if (match == null) continue;
      final candidate = _InlineMatch(
        kind: kind,
        start: cursor + match.start,
        end: cursor + match.end,
      );
      if (next == null || candidate.start < next.start) next = candidate;
    }

    if (next == null) {
      output.add(TextSpan(text: value.substring(cursor), style: base));
      return;
    }
    if (next.start > cursor) {
      output.add(
          TextSpan(text: value.substring(cursor, next.start), style: base));
    }

    final token = value.substring(next.start, next.end);
    switch (next.kind) {
      case _InlineKind.bold:
        _appendDelimited(output, token, 2,
            base.copyWith(fontWeight: FontWeight.w700), palette);
        break;
      case _InlineKind.italic:
        _appendDelimited(output, token, 1,
            base.copyWith(fontStyle: FontStyle.italic), palette);
        break;
      case _InlineKind.strike:
        _appendDelimited(output, token, 2,
            base.copyWith(decoration: TextDecoration.lineThrough), palette);
        break;
      case _InlineKind.code:
        _appendDelimited(
          output,
          token,
          1,
          base.copyWith(
              fontFamily: 'monospace', backgroundColor: palette.codeBackground),
          palette,
        );
        break;
      case _InlineKind.link:
        final closeLabel = token.indexOf('](');
        output
          ..add(TextSpan(text: '[', style: base.copyWith(color: palette.muted)))
          ..add(TextSpan(
            text: token.substring(1, closeLabel),
            style: base.copyWith(
                color: palette.accent, decoration: TextDecoration.underline),
          ))
          ..add(TextSpan(
            text: token.substring(closeLabel),
            style: base.copyWith(color: palette.muted),
          ));
        break;
    }
    cursor = next.end;
  }
}

void _appendDelimited(
  List<InlineSpan> output,
  String token,
  int delimiterLength,
  TextStyle contentStyle,
  MarkdownPalette palette,
) {
  final markerStyle = contentStyle.copyWith(color: palette.muted);
  output
    ..add(
        TextSpan(text: token.substring(0, delimiterLength), style: markerStyle))
    ..add(TextSpan(
      text: token.substring(delimiterLength, token.length - delimiterLength),
      style: contentStyle,
    ))
    ..add(TextSpan(
      text: token.substring(token.length - delimiterLength),
      style: markerStyle,
    ));
}

class _InlineMatch {
  const _InlineMatch(
      {required this.kind, required this.start, required this.end});

  final _InlineKind kind;
  final int start;
  final int end;
}
