import 'dart:convert';

import 'package:flutter/services.dart';

import '../models/ai_allow_list.dart';

/// Loads the model/provider allow list from `assets/models.json`.
///
/// Lives behind a small repository so views depend on a typed list, not on the
/// asset path, and a test can inject its own source.
class AiAllowListRepository {
  const AiAllowListRepository(
      {this.assetPath = 'assets/models.json',
      Future<String> Function()? loadSource})
      : _loadSource = loadSource;

  final String assetPath;
  final Future<String> Function()? _loadSource;

  Future<AiAllowList> load() async {
    final String raw;
    try {
      raw = await (_loadSource ?? () => rootBundle.loadString(assetPath))();
    } catch (error) {
      throw StateError('Could not load $assetPath: $error');
    }
    final AiAllowList? list;
    try {
      list = AiAllowList.tryParse(jsonDecode(raw));
    } catch (_) {
      throw StateError('$assetPath is not valid JSON.');
    }
    if (list == null) {
      throw StateError('$assetPath is not a valid AI allow list.');
    }
    return list;
  }
}
