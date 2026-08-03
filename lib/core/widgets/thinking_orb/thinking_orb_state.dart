/// The agent activities that have a ported orb animation. Upstream ships
/// three more states (`searching`, `listening`, `shaping`) that anotAI does
/// not use yet.
enum ThinkingOrbState {
  working('Working…'),
  solving('Solving…'),
  composing('Composing…');

  const ThinkingOrbState(this.defaultLabel);

  /// Accessibility label used when the caller does not provide one.
  final String defaultLabel;
}

/// Upstream tunes two separate designs instead of scaling one: [avatar] for
/// chat-avatar scale and [inline] for text-height scale. Dot counts, dot radii
/// and speed differ per design.
enum ThinkingOrbScale { avatar, inline }
