import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:anotai/features/ai/data/ai_allow_list_repository.dart';
import 'package:anotai/features/ai/models/ai_allow_list.dart';
import 'package:anotai/features/ai/models/provider_id.dart';

void main() {
  group('AiModel.tryParse', () {
    test('parses a first-party model with reasoning modes', () {
      const raw = {
        'id': 'gpt-5.6-sol',
        'label': 'GPT 5.6 Sol',
        'provider': 'openai',
        'reasoning': {
          'modes': ['minimal', 'low', 'medium', 'high'],
          'default': 'medium'
        },
      };
      final model = AiModel.tryParse(raw);
      expect(model, isNotNull);
      expect(model!.provider, ProviderId.openai);
      expect(model.id, 'gpt-5.6-sol');
      expect(model.reasoningModes, [
        ReasoningMode.minimal,
        ReasoningMode.low,
        ReasoningMode.medium,
        ReasoningMode.high
      ]);
      expect(model.defaultReasoning, ReasoningMode.medium);
    });

    test('parses the OpenRouter duplicate of the same model', () {
      const raw = {
        'id': 'openai/gpt-5.6-sol',
        'label': 'GPT 5.6 Sol',
        'provider': 'openrouter',
        'reasoning': {
          'modes': ['minimal', 'low', 'medium', 'high'],
          'default': 'medium'
        },
      };
      final model = AiModel.tryParse(raw);
      expect(model, isNotNull);
      expect(model!.provider, ProviderId.openrouter);
      expect(model.id, 'openai/gpt-5.6-sol');
    });

    test('rejects a model without a provider', () {
      expect(
        AiModel.tryParse(const {'id': 'x', 'label': 'X'}),
        isNull,
      );
    });
  });

  group('assets/models.json', () {
    test('groups the same models under each provider', () async {
      final raw = await File('assets/models.json').readAsString();
      final list = AiAllowList.tryParse(jsonDecode(raw));
      expect(list, isNotNull);
      expect(list!.providers, hasLength(4));

      // 19 total entries: OpenRouter hosts all 11 models, direct providers
      // repeat their own family.
      expect(list.models, hasLength(19));
      expect(list.modelsFor(ProviderId.openrouter), hasLength(11));
      expect(list.modelsFor(ProviderId.openai), hasLength(3));
      expect(list.modelsFor(ProviderId.anthropic), hasLength(3));
      expect(list.modelsFor(ProviderId.google), hasLength(2));

      // The same GPT-5.6 Sol is selectable either via OpenAI or OpenRouter.
      final direct = list.modelById('gpt-5.6-sol')!;
      expect(direct.provider, ProviderId.openai);
      final viaOpenRouter = list.modelById('openai/gpt-5.6-sol')!;
      expect(viaOpenRouter.provider, ProviderId.openrouter);
      expect(viaOpenRouter.label, direct.label);

      final laguna = list.modelById('poolside/laguna-s-2.1')!;
      expect(laguna.provider, ProviderId.openrouter);
      expect(laguna.reasoningModes,
          [ReasoningMode.disabled, ReasoningMode.enabled]);

      final haiku = list.modelById('anthropic/claude-haiku-4.5')!;
      expect(haiku.reasoningModes,
          [ReasoningMode.disabled, ReasoningMode.enabled]);

      // Effort-supporting cross-cutting models keep effort modes.
      expect(
          list.modelById('deepseek/deepseek-v4-flash')!.reasoningModes.length,
          greaterThan(2));
      expect(list.modelById('z-ai/glm-5.2')!.reasoningModes.length,
          greaterThan(2));
    });
  });

  test('AiAllowListRepository surfaces a malformed list as an error', () async {
    final repository =
        AiAllowListRepository(loadSource: () async => 'not json');
    await expectLater(repository.load(), throwsA(isA<StateError>()));
  });
}
