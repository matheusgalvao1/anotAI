import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/provider_id.dart';
import '../models/selection.dart';

/// Where configured provider keys and the selected model live. The OS
/// keychain backs the real implementation — keys never touch plaintext app
/// storage, and `SELECTED_MODEL` is not a secret but is stored alongside so
/// there is only one settings store.
abstract interface class AiSettingsStore {
  Future<String?> readKey(ProviderId provider);

  Future<void> writeKey(ProviderId provider, String apiKey);

  Future<void> removeKey(ProviderId provider);

  Future<ModelSelection?> readSelection();

  Future<void> writeSelection(ModelSelection selection);
}

class SecureAiSettingsStore implements AiSettingsStore {
  SecureAiSettingsStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  static const _selectionKey = 'SELECTED_MODEL';

  final FlutterSecureStorage _storage;

  @override
  Future<String?> readKey(ProviderId provider) =>
      _storage.read(key: provider.keyStorageKey);

  @override
  Future<void> writeKey(ProviderId provider, String apiKey) =>
      _storage.write(key: provider.keyStorageKey, value: apiKey);

  @override
  Future<void> removeKey(ProviderId provider) =>
      _storage.delete(key: provider.keyStorageKey);

  @override
  Future<ModelSelection?> readSelection() async {
    final stored = await _storage.read(key: _selectionKey);
    return parseSelection(stored);
  }

  @override
  Future<void> writeSelection(ModelSelection selection) =>
      _storage.write(key: _selectionKey, value: selection.encode());
}

/// In-memory store for tests and the simulator-less harness.
class InMemoryAiSettingsStore implements AiSettingsStore {
  final Map<String, String> _keys = {};
  String? _selection;

  @override
  Future<String?> readKey(ProviderId provider) async =>
      _keys[provider.keyStorageKey];

  @override
  Future<void> writeKey(ProviderId provider, String apiKey) async {
    _keys[provider.keyStorageKey] = apiKey;
  }

  @override
  Future<void> removeKey(ProviderId provider) async {
    _keys.remove(provider.keyStorageKey);
  }

  @override
  Future<ModelSelection?> readSelection() async => parseSelection(_selection);

  @override
  Future<void> writeSelection(ModelSelection selection) async {
    _selection = selection.encode();
  }
}
