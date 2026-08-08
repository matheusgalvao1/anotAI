import 'provider_id.dart';

/// A provider entry in `assets/models.json`: the fixed set of inference
/// backends the app can hold keys for.
class AiProvider {
  const AiProvider({
    required this.id,
    required this.label,
    required this.keyPlaceholder,
  });

  final ProviderId id;
  final String label;

  /// Shown in the key field before anything is typed, so the expected shape is
  /// obvious (e.g. `sk-or-v1-…`).
  final String keyPlaceholder;

  static AiProvider? tryParse(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final id = ProviderId.tryParse(_asString(raw['id']));
    if (id == null) return null;
    final label = _asString(raw['label']);
    if (label.isEmpty) return null;
    return AiProvider(
      id: id,
      label: label,
      keyPlaceholder: _asString(raw['keyPlaceholder']),
    );
  }
}

/// The reasoning-effort modes a model actually supports.
///
/// The canonical values shared by every provider's protocol knob:
/// `disabled`, `minimal`, `low`, `medium`, `high`, and `enabled` (for models
/// with a thinking on/off switch but no effort level — Claude Haiku, Laguna).
/// Providers that expose a budget-based thinking knob instead of an effort
/// enum map these onto token budgets in their adapter.
enum ReasoningMode {
  disabled,
  minimal,
  low,
  medium,
  high,
  enabled;

  static ReasoningMode? tryParse(String? value) {
    for (final mode in values) {
      if (mode.name == value) return mode;
    }
    return null;
  }

  /// Human label for the settings picker.
  String get label {
    switch (this) {
      case disabled:
        return 'Off';
      case enabled:
        return 'On';
      case minimal:
        return 'Minimal';
      case low:
        return 'Low';
      case medium:
        return 'Medium';
      case high:
        return 'High';
    }
  }
}

/// One selectable (model, provider) entry from the allow list.
///
/// The same underlying model may appear several times in the list, once per
/// provider that can serve it — the list is grouped by provider, so choosing
/// an entry is simultaneously choosing the route (e.g. `claude-opus-5` via
/// Anthropic or the identical `anthropic/claude-opus-5` slug via OpenRouter).
/// `id` is the exact model id sent to that provider's API.
class AiModel {
  const AiModel({
    required this.id,
    required this.label,
    required this.provider,
    required this.reasoningModes,
    required this.defaultReasoning,
  });

  /// The model id sent to [provider]'s API.
  final String id;

  /// Human label, shared by the repeated entries of the same model.
  final String label;

  /// The provider that serves this entry.
  final ProviderId provider;

  /// The reasoning modes this entry actually supports (see [ReasoningMode]).
  final List<ReasoningMode> reasoningModes;

  final ReasoningMode defaultReasoning;

  static AiModel? tryParse(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final id = _asString(raw['id']);
    if (id.isEmpty) return null;
    final label = _asString(raw['label']);
    if (label.isEmpty) return null;
    final provider = ProviderId.tryParse(_asString(raw['provider']));
    if (provider == null) return null;

    final reasoning = raw['reasoning'];
    final modes = <ReasoningMode>[];
    if (reasoning is Map<String, dynamic>) {
      final rawModes = reasoning['modes'];
      if (rawModes is List) {
        for (final mode in rawModes) {
          final parsed = ReasoningMode.tryParse(mode is String ? mode : null);
          if (parsed != null) modes.add(parsed);
        }
      }
    }
    if (modes.isEmpty) {
      modes.addAll(
          [ReasoningMode.disabled, ReasoningMode.low, ReasoningMode.medium]);
    }
    final defaultRaw = reasoning is Map<String, dynamic>
        ? _asString(reasoning['default'])
        : null;
    final defaultMode = ReasoningMode.tryParse(defaultRaw);
    final fallback = defaultMode != null && modes.contains(defaultMode)
        ? defaultMode
        : modes.last;

    return AiModel(
      id: id,
      label: label,
      provider: provider,
      reasoningModes: List.unmodifiable(modes),
      defaultReasoning: fallback,
    );
  }
}

/// The full contents of `assets/models.json`.
class AiAllowList {
  const AiAllowList({required this.providers, required this.models});

  final List<AiProvider> providers;
  final List<AiModel> models;

  AiProvider? providerById(ProviderId id) {
    for (final provider in providers) {
      if (provider.id == id) return provider;
    }
    return null;
  }

  AiModel? modelById(String id) {
    for (final model in models) {
      if (model.id == id) return model;
    }
    return null;
  }

  /// The entries served by one provider, in catalogue order.
  List<AiModel> modelsFor(ProviderId provider) => models
      .where((model) => model.provider == provider)
      .toList(growable: false);

  static AiAllowList? tryParse(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final providers = <AiProvider>[];
    final providersRaw = raw['providers'];
    if (providersRaw is List) {
      for (final entry in providersRaw) {
        final parsed = AiProvider.tryParse(entry);
        if (parsed != null) providers.add(parsed);
      }
    }
    final models = <AiModel>[];
    final modelsRaw = raw['models'];
    if (modelsRaw is List) {
      for (final entry in modelsRaw) {
        final parsed = AiModel.tryParse(entry);
        if (parsed != null) models.add(parsed);
      }
    }
    if (providers.isEmpty || models.isEmpty) return null;
    return AiAllowList(
      providers: List.unmodifiable(providers),
      models: List.unmodifiable(models),
    );
  }
}

String _asString(Object? value) {
  if (value is String) return value;
  if (value is num) return value.toString();
  return '';
}
