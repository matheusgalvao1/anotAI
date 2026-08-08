/// The inference backends Settings can store a key for. All four are always
/// present in the allow list — there is no add/remove of providers, only of
/// which of them a user has configured a key for.
enum ProviderId {
  openrouter,
  openai,
  anthropic,
  google;

  /// The key that opens `assets/models.json` for this provider.
  String get jsonId => name;

  /// Storage key for this provider's API key (kept in the OS keychain).
  String get keyStorageKey => '${name.toUpperCase()}_API_KEY';

  static ProviderId? tryParse(String? value) {
    for (final id in ProviderId.values) {
      if (id.name == value) return id;
    }
    return null;
  }
}
