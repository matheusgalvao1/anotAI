import '../data/agent/types.dart';
import '../data/agent_provider_factory.dart';
import '../data/ai_settings_store.dart';
import '../models/ai_allow_list.dart';
import '../models/provider_id.dart';

/// Signature for turning a stored selection into a live `Provider`, injectable
/// so tests can substitute scripted providers for network adapters.
typedef AgentProviderBuilder = Provider Function({
  required ProviderId provider,
  required String apiKey,
  required String model,
  required ReasoningMode reasoning,
});

/// Builds the configured `Provider` the editor uses for one turn, resolving
/// the user's stored selection (a (model, provider) entry + reasoning) against
/// the allow list and the stored API key. Returns null when the user hasn't
/// configured enough to run a turn, so the editor can prompt them toward
/// Settings.
class AgentController {
  AgentController({
    required AiSettingsStore settings,
    required AiAllowList allowList,
    AgentProviderBuilder? providerBuilder,
  })  : _settings = settings,
        _allowList = allowList,
        _providerBuilder = providerBuilder ?? buildAgentProvider;

  final AiSettingsStore _settings;
  final AiAllowList _allowList;
  final AgentProviderBuilder _providerBuilder;

  Future<Provider?> providerForTurn() async {
    final selection = await _settings.readSelection();
    if (selection == null) return null;
    final model = _allowList.modelById(selection.modelId);
    if (model == null) return null;
    final key = await _settings.readKey(model.provider);
    if (key == null || key.trim().isEmpty) return null;
    return _providerBuilder(
      provider: model.provider,
      apiKey: key.trim(),
      model: model.id,
      reasoning: selection.reasoning,
    );
  }
}
