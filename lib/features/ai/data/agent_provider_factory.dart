import 'agent/providers/anthropic.dart';
import 'agent/providers/google.dart';
import 'agent/providers/openai.dart';
import 'agent/providers/openrouter.dart';
import 'agent/transport.dart';
import 'agent/types.dart';
import '../models/ai_allow_list.dart';
import '../models/provider_id.dart';

/// Chooses the adapter for a provider id, given a concrete model id and the
/// reasoning mode the user selected in Settings.
///
/// Lives outside the agent core so the adapter registry can grow without the
/// loop knowing about it: the core sees only the `Provider` interface.
Provider buildAgentProvider({
  required ProviderId provider,
  required String apiKey,
  required String model,
  required ReasoningMode reasoning,
  HttpTransport? transport,
}) {
  switch (provider) {
    case ProviderId.openrouter:
      // `X-Title` is OpenRouter's attribution convention. No user identifiers.
      return OpenRouterProvider(
        apiKey: apiKey,
        model: model,
        reasoning: reasoning,
        transport: transport,
        extraHeaders: const {'X-Title': 'anotAI'},
      );
    case ProviderId.openai:
      return OpenAiProvider(
          apiKey: apiKey,
          model: model,
          reasoning: reasoning,
          transport: transport);
    case ProviderId.anthropic:
      return AnthropicProvider(
          apiKey: apiKey,
          model: model,
          reasoning: reasoning,
          transport: transport);
    case ProviderId.google:
      return GoogleProvider(
          apiKey: apiKey,
          model: model,
          reasoning: reasoning,
          transport: transport);
  }
}
