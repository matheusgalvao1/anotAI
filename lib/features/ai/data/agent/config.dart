/// Agent loop guardrails, deliberately configuration here so tuning them never
/// touches the loop itself.
class AgentConfig {
  const AgentConfig();

  /// The most iterations one turn may run before it is cut off. Every
  /// iteration is one provider round trip plus whatever tool calls it issued.
  static const int maxIterations = 8;

  /// History above this estimated token count gets compacted before the next
  /// request (see `compaction.dart`).
  static const int compactThresholdTokens = 50_000;

  /// Notes at or above this many tokens are not inlined into the system
  /// prompt; the model is told to page through them with `read_note`.
  static const int inlineNoteTokenLimit = 6_000;

  /// Notes below this token count drop the `patch_note` tool entirely, since
  /// rewriting is simpler and less error-prone for a tiny body.
  static const int forceRewriteBelowTokens = 500;

  static const Duration requestTimeout = Duration(minutes: 2);

  /// Maximum note size defensively accepted; anything larger is reported as a
  /// storage error rather than fed to a model.
  static const int maxNoteBytes = 2 * 1024 * 1024;

  static const int readNoteDefaultLimitLines = 500;
  static const int systemPromptPreviewLines = 50;
}
