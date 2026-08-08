import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/ai/models/ai_allow_list.dart'
    show ReasoningMode;
import 'package:anotai/features/ai/models/selection.dart';

void main() {
  test('round-trips through encode/parseSelection', () {
    const selection = ModelSelection(
      modelId: 'anthropic/claude-opus-5',
      reasoning: ReasoningMode.high,
    );
    final decoded = parseSelection(selection.encode());
    expect(decoded, selection);
  });

  test('round-trips a first-party entry and disabled reasoning', () {
    const selection = ModelSelection(
      modelId: 'claude-opus-5',
      reasoning: ReasoningMode.disabled,
    );
    expect(parseSelection(selection.encode()), selection);
  });

  test('treats corrupt or incomplete shapes as nothing selected', () {
    expect(parseSelection(null), isNull);
    expect(parseSelection(''), isNull);
    expect(parseSelection('not json'), isNull);
    expect(parseSelection('{"modelId": 4}'), isNull);
    expect(parseSelection('{"reasoning": "high"}'), isNull);
    expect(parseSelection('{"modelId": "x", "reasoning": "nope"}'), isNull);
  });
}
