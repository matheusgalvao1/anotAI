import 'dart:convert';

import 'ai_allow_list.dart';

/// A chosen (model, provider) entry from the allow list plus the reasoning
/// mode to run it with. Because the allow list is grouped by provider, the
/// `modelId` alone already decides the route.
class ModelSelection {
  const ModelSelection({required this.modelId, required this.reasoning});

  final String modelId;

  /// One of the model's supported [ReasoningMode] values.
  final ReasoningMode reasoning;

  String encode() => jsonEncode({
        'modelId': modelId,
        'reasoning': reasoning.name,
      });

  @override
  bool operator ==(Object other) =>
      other is ModelSelection &&
      other.modelId == modelId &&
      other.reasoning == reasoning;

  @override
  int get hashCode => Object.hash(modelId, reasoning);
}

/// Reads a stored selection, treating anything unexpected as "nothing
/// selected". Stored values are untrusted — they can be corrupt, hand-edited,
/// or written by a newer build — so every bad shape has to degrade instead of
/// throwing.
ModelSelection? parseSelection(String? stored) {
  if (stored == null || stored.isEmpty) return null;
  try {
    final value = jsonDecode(stored);
    if (value is! Map<String, dynamic>) return null;
    final modelId = value['modelId'];
    if (modelId is! String || modelId.isEmpty) return null;
    final reasoning = ReasoningMode.tryParse(value['reasoning']);
    if (reasoning == null) return null;
    return ModelSelection(modelId: modelId, reasoning: reasoning);
  } catch (_) {
    return null;
  }
}
