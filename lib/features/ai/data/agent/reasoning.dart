import '../../models/ai_allow_list.dart';

/// Maps a canonical [ReasoningMode] onto the effort string the OpenAI-shaped
/// protocols understand (OpenRouter's `reasoning_effort` / `reasoning.effort`,
/// OpenAI's Responses `reasoning.effort`). Returns null for modes without an
/// effort level (disabled, enabled).
String? effortValue(ReasoningMode mode) {
  switch (mode) {
    case ReasoningMode.minimal:
      return 'minimal';
    case ReasoningMode.low:
      return 'low';
    case ReasoningMode.medium:
      return 'medium';
    case ReasoningMode.high:
      return 'high';
    case ReasoningMode.disabled:
    case ReasoningMode.enabled:
      return null;
  }
}
