// Dart port of the thinking-orbs canvas engine.
// MIT © Jakub Antalik — https://github.com/Jakubantalik/thinking-orbs
//
// Dots are z-sorted and depth is carried by dot size and ink weight alone, so
// the port stays faithful to the upstream 2D-canvas output: no shaders, no
// blur, no gradients.

import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';

import 'thinking_orb_state.dart';

class ThinkingOrbPainter extends CustomPainter {
  ThinkingOrbPainter({
    required Listenable super.repaint,
    required this.clock,
    required this.state,
    required this.scale,
    required this.dark,
    required this.speed,
    required this.animate,
  });

  /// Elapsed seconds of the clock shared by every mounted orb.
  final ValueListenable<double> clock;
  final ThinkingOrbState state;
  final ThinkingOrbScale scale;
  final bool dark;
  final double speed;
  final bool animate;

  /// Deterministic frame shown when motion is suppressed.
  static const staticFrameTime = 0.6;

  @override
  void paint(Canvas canvas, Size size) {
    final resolved = _resolvePreset(state, scale);
    final time =
        animate ? clock.value * resolved.speed * speed : staticFrameTime;
    resolved.draw(canvas, size.shortestSide, time, dark, resolved.opts);
  }

  @override
  bool shouldRepaint(ThinkingOrbPainter oldDelegate) =>
      oldDelegate.clock != clock ||
      oldDelegate.state != state ||
      oldDelegate.scale != scale ||
      oldDelegate.dark != dark ||
      oldDelegate.speed != speed ||
      oldDelegate.animate != animate;
}

// --- Shared primitives -------------------------------------------------

class _Dot {
  const _Dot({
    required this.x,
    required this.y,
    required this.z,
    required this.r,
    required this.white,
    this.alpha = 1,
  });

  final double x;
  final double y;
  final double z;
  final double r;

  /// Ink value: 0 is the darkest ink on paper. Mirrored on dark themes.
  final double white;
  final double alpha;
}

typedef _Projected = (double x, double y, double z);
typedef _Projector = _Projected Function(double x, double y, double z);

typedef _ModeDraw = void Function(
  Canvas canvas,
  double size,
  double t,
  bool dark,
  _Opts o,
);

/// Deterministic hash in [0, 1).
double _hashD(double a, double b) {
  final h = math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - h.floorToDouble();
}

/// Stable directions on a unit sphere (Fibonacci lattice).
_Projected _fibDir(int i, int n) {
  final golden = math.pi * (3 - math.sqrt(5));
  final y = 1 - (2 * (i + 0.5)) / n;
  final rad = math.sqrt(1 - y * y);
  final a = i * golden;
  return (rad * math.cos(a), y, rad * math.sin(a));
}

/// Shared spin + tilt + orthographic projection.
_Projector _makeProj(
  double yaw,
  double tilt,
  double cx,
  double cy,
  double scale,
) {
  final st = math.sin(tilt);
  final ct = math.cos(tilt);
  final sy = math.sin(yaw);
  final cyw = math.cos(yaw);
  return (x, y, z) {
    final x1 = x * cyw + z * sy;
    final z1 = -x * sy + z * cyw;
    final y1 = y * ct - z1 * st;
    final z2 = y * st + z1 * ct;
    return (cx + x1 * scale, cy - y1 * scale, z2);
  };
}

/// Painter: z-sort far to near, matte grayscale dots. On dark substrates the
/// ink value is mirrored so near dots read bright.
void _paintDots(Canvas canvas, List<_Dot> dots, bool dark, double rMin) {
  dots.sort((a, b) => a.z.compareTo(b.z));
  final brush = Paint();
  for (final dot in dots) {
    if (dot.alpha < 0.02) continue;
    final white = dot.white.clamp(0.0, 1.0);
    final grey = ((dark ? 1 - white : white) * 255).round();
    brush.color = Color.fromARGB(
      (dot.alpha.clamp(0.0, 1.0) * 255).round(),
      grey,
      grey,
      grey,
    );
    canvas.drawCircle(
      Offset(dot.x, dot.y),
      math.max(rMin, dot.r),
      brush,
    );
  }
}

/// Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small
/// orbs legible.
double _radiusScale(double size, double pow) =>
    math.pow(size / 300, pow).toDouble();

// --- Draw options ------------------------------------------------------

class _Opts {
  const _Opts(this._values);

  final Map<String, double> _values;

  double d(String key, double fallback) => _values[key] ?? fallback;

  int i(String key, int fallback) => _values[key]?.round() ?? fallback;
}

enum _OrbMode { orbits, rubik, ribbon }

/// Base (fine) profiles per mode, before preset multipliers.
const Map<_OrbMode, Map<String, double>> _baseProfiles = {
  _OrbMode.orbits: {
    'orbitN': 12,
    'ghostN': 40,
    'ghostR': 0.9,
    'ghostA': 0.5,
    'particles': 3,
    'partR': 1.2,
    'partRDepth': 1.6,
    'rsPow': 0.6,
    'rMin': 0.3,
  },
  _OrbMode.rubik: {
    'latRings': 15,
    'lonDensity': 40,
    'moveCount': 14,
    'rBase': 0.6,
    'rDepth': 1.7,
    'rActive': 0.3,
    'inkFar': 0.62,
    'inkSpan': 0.54,
    'rsPow': 0.6,
    'rMin': 0.3,
  },
  _OrbMode.ribbon: {
    'lanes': 5,
    'segs': 88,
    'ghostN': 150,
    'rBase': 1.1,
    'rDepth': 1.7,
    'rsPow': 0.6,
    'rMin': 0.3,
  },
};

class _Preset {
  const _Preset({
    required this.speed,
    required this.count,
    required this.size,
    this.extra = const {},
  });

  final double speed;
  final double count;
  final double size;
  final Map<String, double> extra;
}

/// The shipped tunings. `count` and `size` multiply the base profiles; `speed`
/// multiplies the shared clock.
const Map<_OrbMode, Map<ThinkingOrbScale, _Preset>> _presets = {
  _OrbMode.orbits: {
    ThinkingOrbScale.avatar: _Preset(speed: 1.885, count: 1, size: 1),
    ThinkingOrbScale.inline: _Preset(speed: 3.9, count: 0.238, size: 2.4),
  },
  _OrbMode.rubik: {
    ThinkingOrbScale.avatar: _Preset(speed: 1.82, count: 0.35, size: 1.05),
    ThinkingOrbScale.inline: _Preset(speed: 1.95, count: 0.088, size: 1.9),
  },
  _OrbMode.ribbon: {
    ThinkingOrbScale.avatar: _Preset(
      speed: 2.34,
      count: 0.25,
      size: 0.85,
      extra: {'spin': 0, 'bandMul': 3.9, 'wobMul': 1},
    ),
    ThinkingOrbScale.inline: _Preset(
      speed: 3.12,
      count: 0.051,
      size: 1.073,
      extra: {'spin': 0, 'bandMul': 4.94, 'wobMul': 1},
    ),
  },
};

// Lattices come in (rings x dots-per-ring) pairs — each side takes the square
// root of the multiplier so the total dot count scales by it; flat lists scale
// linearly.
const _countPairs = [
  ('latRings', 'lonDensity'),
  ('lanes', 'segs'),
];
const _countKeys = ['orbitN', 'ghostN'];

// Every key that sets a rendered radius: scaling all of them together keeps a
// dot's near/far falloff intact while shrinking or growing the mark.
const _radiusKeys = [
  'rBase',
  'rDepth',
  'rActive',
  'ghostR',
  'partR',
  'partRDepth',
];

Map<String, double> _scaleCounts(Map<String, double> opts, double scale) {
  final out = Map<String, double>.of(opts);
  final done = <String>{};
  final rt = math.sqrt(scale);
  for (final (a, b) in _countPairs) {
    final va = out[a];
    final vb = out[b];
    if (va != null && vb != null && !done.contains(a) && !done.contains(b)) {
      out[a] = math.max(2, (va * rt).round()).toDouble();
      out[b] = math.max(2, (vb * rt).round()).toDouble();
      done.addAll([a, b]);
    }
  }
  for (final key in _countKeys) {
    final value = out[key];
    if (value != null && !done.contains(key)) {
      out[key] = math.max(1, (value * scale).round()).toDouble();
    }
  }
  return out;
}

Map<String, double> _scaleRadii(Map<String, double> opts, double scale) {
  final out = Map<String, double>.of(opts);
  for (final key in _radiusKeys) {
    final value = out[key];
    if (value != null) out[key] = value * scale;
  }
  return out;
}

class _Resolved {
  const _Resolved({
    required this.draw,
    required this.speed,
    required this.opts,
  });

  final _ModeDraw draw;
  final double speed;
  final _Opts opts;
}

const Map<ThinkingOrbState, _OrbMode> _stateModes = {
  ThinkingOrbState.working: _OrbMode.orbits,
  ThinkingOrbState.solving: _OrbMode.rubik,
  ThinkingOrbState.composing: _OrbMode.ribbon,
};

const Map<_OrbMode, _ModeDraw> _modeDraws = {
  _OrbMode.orbits: _drawOrbits,
  _OrbMode.rubik: _drawRubik,
  _OrbMode.ribbon: _drawRibbon,
};

final _resolvedCache = <(ThinkingOrbState, ThinkingOrbScale), _Resolved>{};

/// Resolve a (state, scale) pair to its mode and fully scaled draw options.
_Resolved _resolvePreset(ThinkingOrbState state, ThinkingOrbScale scale) {
  return _resolvedCache.putIfAbsent((state, scale), () {
    final mode = _stateModes[state]!;
    final preset = _presets[mode]![scale]!;
    var opts = Map<String, double>.of(_baseProfiles[mode]!);
    if (preset.count != 1) opts = _scaleCounts(opts, preset.count);
    if (preset.size != 1) opts = _scaleRadii(opts, preset.size);
    opts.addAll(preset.extra);
    return _Resolved(
      draw: _modeDraws[mode]!,
      speed: preset.speed,
      opts: _Opts(opts),
    );
  });
}

// --- Orbits: particles on tilted orbits (working) ----------------------

void _drawOrbits(Canvas canvas, double size, double t, bool dark, _Opts o) {
  final centre = size / 2;
  final radius = centre * 0.82;
  final project = _makeProj(t * 0.12, 0.3, centre, centre, 1);
  final rs = _radiusScale(size, o.d('rsPow', 0.6));

  final dots = <_Dot>[];
  final orbitN = o.i('orbitN', 12);
  final ghostN = o.i('ghostN', 40);
  final particles = o.i('particles', 3);
  final ghostR = o.d('ghostR', 0.9);
  final ghostA = o.d('ghostA', 0.5);
  final partR = o.d('partR', 1.2);
  final partRDepth = o.d('partRDepth', 1.6);

  for (var orb = 0; orb < orbitN; orb++) {
    final h1 = _hashD(orb.toDouble(), 1.7);
    final h2 = _hashD(orb.toDouble(), 5.2);
    final h3 = _hashD(orb.toDouble(), 8.9);
    final ro = radius * (0.45 + 0.52 * h1);
    final th = h1 * 2 * math.pi;
    final phi = math.acos(2 * h2 - 1);
    // orbit plane basis (u, v perpendicular to normal n)
    final nx = math.sin(phi) * math.cos(th);
    final ny = math.cos(phi);
    final nz = math.sin(phi) * math.sin(th);
    var ux = -ny;
    var uy = nx;
    const uz = 0.0;
    final ul = math.max(1e-6, math.sqrt(ux * ux + uy * uy));
    ux /= ul;
    uy /= ul;
    final vx = ny * uz - nz * uy;
    final vy = nz * ux - nx * uz;
    final vz = nx * uy - ny * ux;
    final speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);

    for (var k = 0; k < ghostN; k++) {
      final a = (k / ghostN) * 2 * math.pi;
      final (px, py, z) = project(
        (ux * math.cos(a) + vx * math.sin(a)) * ro,
        (uy * math.cos(a) + vy * math.sin(a)) * ro,
        (uz * math.cos(a) + vz * math.sin(a)) * ro,
      );
      final depth = (z / ro + 1) / 2;
      dots.add(_Dot(
        x: px,
        y: py,
        z: z,
        r: ghostR * rs,
        white: 0.72,
        alpha: ghostA * (0.4 + 0.6 * depth),
      ));
    }
    for (var m = 0; m < particles; m++) {
      final a = t * speed + (m / particles) * 2 * math.pi + h2 * 6;
      final (px, py, z) = project(
        (ux * math.cos(a) + vx * math.sin(a)) * ro,
        (uy * math.cos(a) + vy * math.sin(a)) * ro,
        (uz * math.cos(a) + vz * math.sin(a)) * ro,
      );
      final depth = (z / ro + 1) / 2;
      dots.add(_Dot(
        x: px,
        y: py,
        z: z,
        r: (partR + partRDepth * depth) * rs,
        white: 0.3 - 0.22 * depth,
      ));
    }
  }
  _paintDots(canvas, dots, dark, o.d('rMin', 0.3));
}

// --- Rubik: bands scramble, then click back solved (solving) -----------

class _Move {
  const _Move({
    required this.axis,
    required this.lo,
    required this.hi,
    required this.ang,
  });

  final int axis;
  final double lo;
  final double hi;
  final double ang;
}

final _movesCache = <int, List<_Move>>{};

List<_Move> _makeMoves(int count) {
  return _movesCache.putIfAbsent(count, () {
    return List<_Move>.generate(count, (i) {
      final axis = math.min(2, (_hashD(i.toDouble(), 2.3) * 3).floor());
      final lo =
          -1.0 + 0.5 * math.min(3, (_hashD(i.toDouble(), 5.9) * 4).floor());
      final dir = _hashD(i.toDouble(), 7.7) < 0.5 ? 1 : -1;
      return _Move(axis: axis, lo: lo, hi: lo + 0.5, ang: dir * math.pi / 2);
    });
  });
}

class _SolveCycle {
  const _SolveCycle(this.amount, this.active);

  final List<double> amount;
  final int active;
}

/// Rapid eased moves scramble, then replay in reverse so everything clicks
/// back to solved, rests, repeats.
_SolveCycle _solveCycle(double time, int count, double slotDur, double rest) {
  final cycle = 2 * count * slotDur + rest;
  final tc = time % cycle;
  final amount = List<double>.filled(count, 0);
  var active = -1;
  if (tc < 2 * count * slotDur) {
    final slot = (tc / slotDur).floor();
    final p = (tc - slot * slotDur) / slotDur;
    final cl = math.min(1.0, p / 0.7);
    final ep = 1 - math.pow(1 - cl, 3).toDouble(); // machine ease-out
    if (slot < count) {
      for (var i = 0; i < slot; i++) {
        amount[i] = 1;
      }
      amount[slot] = ep;
      active = slot;
    } else {
      final u = 2 * count - 1 - slot;
      for (var i = 0; i < u; i++) {
        amount[i] = 1;
      }
      amount[u] = 1 - ep;
      active = u;
    }
  }
  return _SolveCycle(amount, active);
}

(double, double, double, bool) _applyMoves(
  _Projected point,
  List<_Move> moves,
  _SolveCycle cycle,
) {
  var (x, y, z) = point;
  var inActive = false;
  for (var i = 0; i < moves.length; i++) {
    if (cycle.amount[i] <= 0) continue;
    final move = moves[i];
    final coord = switch (move.axis) {
      0 => x,
      1 => y,
      _ => z,
    };
    if (coord < move.lo || coord >= move.hi) continue;
    if (i == cycle.active) inActive = true;
    final a = move.ang * cycle.amount[i];
    final ca = math.cos(a);
    final sa = math.sin(a);
    if (move.axis == 0) {
      final y2 = y * ca - z * sa;
      z = y * sa + z * ca;
      y = y2;
    } else if (move.axis == 1) {
      final x2 = x * ca + z * sa;
      z = -x * sa + z * ca;
      x = x2;
    } else {
      final x2 = x * ca - y * sa;
      y = x * sa + y * ca;
      x = x2;
    }
  }
  return (x, y, z, inActive);
}

void _drawRubik(Canvas canvas, double size, double t, bool dark, _Opts o) {
  final centre = size / 2;
  final radius = centre * 0.82;
  final project = _makeProj(
    t * 0.55,
    0.35 + 0.1 * math.sin(t * 0.9),
    centre,
    centre,
    radius,
  );
  final rs = _radiusScale(size, o.d('rsPow', 0.6));
  final moveCount = o.i('moveCount', 14);
  final moves = _makeMoves(moveCount);
  final cycle = _solveCycle(t, moveCount, 0.42, 1.2);

  final dots = <_Dot>[];
  final latRings = o.i('latRings', 15);
  final lonDensity = o.i('lonDensity', 40);
  final rBase = o.d('rBase', 0.6);
  final rDepth = o.d('rDepth', 1.7);
  final rActive = o.d('rActive', 0.3);
  final inkFar = o.d('inkFar', 0.62);
  final inkSpan = o.d('inkSpan', 0.54);

  for (var li = 0; li <= latRings; li++) {
    final lat = -math.pi / 2 + (li / latRings) * math.pi;
    final cosLat = math.cos(lat);
    final sinLat = math.sin(lat);
    final lonCount = math.max(1, (cosLat.abs() * lonDensity).round());
    for (var lj = 0; lj < lonCount; lj++) {
      final lon = (lj / lonCount) * 2 * math.pi;
      final (x, y, z, inActive) = _applyMoves(
        (cosLat * math.cos(lon), sinLat, cosLat * math.sin(lon)),
        moves,
        cycle,
      );
      final (px, py, zr) = project(x, y, z);
      final depth = (zr + 1) / 2;
      // the band being turned inks a touch darker — the "hand"
      dots.add(_Dot(
        x: px,
        y: py,
        z: zr,
        r: (rBase + rDepth * depth + (inActive ? rActive : 0)) * rs,
        white: inkFar - inkSpan * depth - (inActive ? 0.14 : 0),
      ));
    }
  }
  _paintDots(canvas, dots, dark, o.d('rMin', 0.3));
}

// --- Ribbon: an undulating multi-band sash (composing) -----------------

void _drawRibbon(Canvas canvas, double size, double t, bool dark, _Opts o) {
  final centre = size / 2;
  final radius = centre * 0.78;
  // spin scales the 3D tumble; spin 0 freezes the band's orientation, leaving
  // only the traveling undulation
  final spin = o.d('spin', 1);
  final project = _makeProj(t * 0.1 * spin, 0.3, centre, centre, 1);
  final rs = _radiusScale(size, o.d('rsPow', 0.6));

  final dots = <_Dot>[];
  final ghostN = o.i('ghostN', 150);
  for (var i = 0; i < ghostN; i++) {
    final dir = _fibDir(i, ghostN);
    final (px, py, z) =
        project(dir.$1 * radius, dir.$2 * radius, dir.$3 * radius);
    final depth = (z / radius + 1) / 2;
    dots.add(_Dot(
      x: px,
      y: py,
      z: z,
      r: 0.8 * rs,
      white: 0.78,
      alpha: 0.1 + 0.22 * depth,
    ));
  }

  final ya = t * 0.24 * spin;
  final ta = 0.55 + 0.3 * math.sin(t * 0.18) * spin;
  final ux = math.cos(ya);
  const uy = 0.0;
  final uz = math.sin(ya);
  final vx = -uz * math.sin(ta);
  final vy = math.cos(ta);
  final vz = ux * math.sin(ta);
  // plane normal n = u x v
  final nx = uy * vz - uz * vy;
  final ny = uz * vx - ux * vz;
  final nz = ux * vy - uy * vx;

  final baseLanes = o.i('lanes', 5);
  final segs = o.i('segs', 88);
  final lanes = math.max(1, (baseLanes * o.d('bandMul', 1)).round());
  final wobMul = o.d('wobMul', 1);
  final rBase = o.d('rBase', 1.1);
  final rDepth = o.d('rDepth', 1.7);

  for (var w = 0; w < lanes; w++) {
    final laneOff = (w - (lanes - 1) / 2) * 0.075;
    final edge =
        (w - (lanes - 1) / 2).abs() / math.max(1, (lanes - 1) / 2).toDouble();
    for (var k = 0; k < segs; k++) {
      final a = (k / segs) * 2 * math.pi;
      // two traveling waves along the band
      final wob = (0.16 * math.sin(a * 3 - t * 1.7 + w * 0.22) +
              0.07 * math.sin(a * 5 + t * 1.1)) *
          wobMul;
      final off = laneOff + wob;
      final x = ux * math.cos(a) + vx * math.sin(a) + nx * off;
      final y = uy * math.cos(a) + vy * math.sin(a) + ny * off;
      final z = uz * math.cos(a) + vz * math.sin(a) + nz * off;
      final l = math.sqrt(x * x + y * y + z * z);
      final (px, py, zr) = project(
        (x / l) * radius,
        (y / l) * radius,
        (z / l) * radius,
      );
      final depth = (zr / radius + 1) / 2;
      dots.add(_Dot(
        x: px,
        y: py,
        z: zr,
        r: (rBase + rDepth * depth) * (1 - 0.25 * edge) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge,
        alpha: 0.4 + 0.6 * depth,
      ));
    }
  }
  _paintDots(canvas, dots, dark, o.d('rMin', 0.3));
}
