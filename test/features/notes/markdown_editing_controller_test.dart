import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/notes/widgets/markdown_editing_controller.dart';

void main() {
  const palette = MarkdownPalette(
    text: Colors.black,
    muted: Colors.grey,
    accent: Colors.orange,
    codeBackground: Color(0xFFEFEFEF),
  );

  test('live markdown spans preserve the exact source text', () {
    const source =
        '# Heading\nA **bold** and *italic* [link](https://example.com).\n```\ncode\n```';
    final span = buildMarkdownTextSpan(
      text: source,
      baseStyle: const TextStyle(fontSize: 17),
      palette: palette,
    );

    expect(span.toPlainText(), source);
  });

  test('heading content receives a larger visual style', () {
    final span = buildMarkdownTextSpan(
      text: '# Heading',
      baseStyle: const TextStyle(fontSize: 17),
      palette: palette,
    );
    final children = span.children!.cast<TextSpan>();

    expect(children.last.text, 'Heading');
    expect(children.last.style!.fontSize, 28);
    expect(children.last.style!.fontWeight, FontWeight.w700);
  });
}
