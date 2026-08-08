import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'thinking_orb_painter.dart';
import 'thinking_orb_state.dart';

export 'thinking_orb_state.dart';

/// Every orb reads the same clock so instances mounted at different times stay
/// in phase with each other.
final Stopwatch _sharedClock = Stopwatch()..start();

/// A dotted thought orb that renders an agent activity.
///
/// The animation is painted per frame from the raw dot field, so it stays crisp
/// at any size and follows the ambient theme brightness.
class ThinkingOrb extends StatefulWidget {
  const ThinkingOrb({
    required this.state,
    this.size = 64,
    this.scale,
    this.speed = 1,
    this.paused = false,
    this.semanticLabel,
    super.key,
  });

  final ThinkingOrbState state;

  /// Rendered edge length in logical pixels.
  final double size;

  /// Which tuned design to render. Defaults to [ThinkingOrbScale.avatar] for
  /// larger orbs and [ThinkingOrbScale.inline] for smaller ones.
  final ThinkingOrbScale? scale;

  /// Multiplies the preset's baked speed.
  final double speed;

  /// Freezes the animation on a deterministic frame.
  final bool paused;

  final String? semanticLabel;

  static const _inlineThreshold = 40.0;

  ThinkingOrbScale get _resolvedScale =>
      scale ??
      (size >= _inlineThreshold
          ? ThinkingOrbScale.avatar
          : ThinkingOrbScale.inline);

  @override
  State<ThinkingOrb> createState() => _ThinkingOrbState();
}

class _ThinkingOrbState extends State<ThinkingOrb>
    with SingleTickerProviderStateMixin {
  final _clock = ValueNotifier<double>(0);
  late final Ticker _ticker;

  bool get _animate =>
      !widget.paused && !MediaQuery.disableAnimationsOf(context);

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((_) => _clock.value = _elapsedSeconds);
    _clock.value = _elapsedSeconds;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncTicker();
  }

  @override
  void didUpdateWidget(ThinkingOrb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.paused != widget.paused) _syncTicker();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _clock.dispose();
    super.dispose();
  }

  double get _elapsedSeconds =>
      _sharedClock.elapsedMicroseconds / Duration.microsecondsPerSecond;

  void _syncTicker() {
    if (_animate && !_ticker.isActive) {
      _ticker.start();
    } else if (!_animate && _ticker.isActive) {
      _ticker.stop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.semanticLabel ?? widget.state.defaultLabel,
      image: true,
      child: SizedBox.square(
        dimension: widget.size,
        child: CustomPaint(
          painter: ThinkingOrbPainter(
            repaint: _clock,
            clock: _clock,
            state: widget.state,
            scale: widget._resolvedScale,
            dark: Theme.of(context).brightness == Brightness.dark,
            speed: widget.speed,
            animate: _animate,
          ),
        ),
      ),
    );
  }
}
