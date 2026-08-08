import 'package:flutter/foundation.dart';

import '../data/ai_allow_list_repository.dart';
import '../data/ai_settings_store.dart';
import '../models/ai_allow_list.dart';
import '../models/provider_id.dart';
import '../models/selection.dart';

/// Holds the AI configuration the Settings screen edits and the agent reads:
/// which providers have keys and which model is selected (with its connection
/// and reasoning mode).
class SettingsController extends ChangeNotifier {
  SettingsController({
    required AiAllowListRepository allowListRepository,
    required AiSettingsStore store,
  })  : _allowListRepository = allowListRepository,
        _store = store;

  final AiAllowListRepository _allowListRepository;
  final AiSettingsStore _store;

  AiAllowList? _allowList;
  Map<ProviderId, String> _keys = const {};
  ModelSelection? _selection;
  Object? _error;

  AiAllowList? get allowList => _allowList;
  Map<ProviderId, String> get keys => _keys;
  ModelSelection? get selection => _selection;
  Object? get error => _error;

  /// A per-provider key the user actually set (non-empty).
  bool hasKey(ProviderId provider) => (_keys[provider] ?? '').trim().isNotEmpty;

  Future<void> load() async {
    try {
      final list = await _allowListRepository.load();
      final keys = <ProviderId, String>{};
      for (final provider in list.providers) {
        final stored = await _store.readKey(provider.id);
        if (stored != null && stored.isNotEmpty) keys[provider.id] = stored;
      }
      _allowList = list;
      _keys = keys;
      final selection = await _store.readSelection();
      // A selection that no longer resolves against the allow list (e.g. a
      // model id that was renamed in the catalogue) is treated as unset so
      // the user can always pick a fresh model.
      _selection =
          selection != null && list.modelById(selection.modelId) != null
              ? selection
              : null;
      _error = null;
      notifyListeners();
    } catch (error) {
      _error = error;
      notifyListeners();
    }
  }

  Future<void> setApiKey(ProviderId provider, String apiKey) async {
    final trimmed = apiKey.trim();
    if (trimmed.isEmpty) return;
    await _store.writeKey(provider, trimmed);
    _keys = {..._keys, provider: trimmed};
    notifyListeners();
  }

  Future<void> removeApiKey(ProviderId provider) async {
    await _store.removeKey(provider);
    _keys = {..._keys}..remove(provider);
    notifyListeners();
  }

  Future<void> setSelection(ModelSelection selection) async {
    await _store.writeSelection(selection);
    _selection = selection;
    notifyListeners();
  }
}
