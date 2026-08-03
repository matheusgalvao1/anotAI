# anotAI

anotAI is a local-first notes app for iOS and Android. It aims to feel like a
fast, ordinary phone notes app while adding an AI instruction surface that can
edit the open note directly.

This branch is the Flutter rewrite. The current milestone is UI-only:

- note list with create, swipe-to-delete, and undo;
- one editable, scrollable note surface;
- live Obsidian-style Markdown formatting without a preview toggle;
- light, dark, and system appearance modes;
- an animated thought orb that opens a focused AI instruction field, then sits
  beside it and switches while an instruction is being worked on;
- a note that stays scrollable but becomes read-only while that field is open.

Notes currently live in an in-memory repository and reset when the app restarts.
Local markdown-file persistence and AI providers are the next implementation
phases.

## Architecture

The UI follows feature-first MVC boundaries:

```text
lib/
  app/                         app composition
  core/theme/                  shared visual system
  core/widgets/                shared presentation components
  features/notes/
    models/                    immutable note data
    data/                      repository contracts and implementations
    controllers/               screen state and use-case coordination
    views/                     pages and navigation
    widgets/                   live Markdown editor and AI composer
  features/settings/
    controllers/
    views/
```

See [docs/flutter-architecture.md](docs/flutter-architecture.md) for the key
interaction and dependency rules.

## Setup

The repository pins Flutter through [FVM](https://fvm.app/). Install FVM, then:

```bash
fvm install
fvm flutter pub get
```

## Run and verify

```bash
fvm flutter run
fvm dart format --output=none --set-exit-if-changed lib test
fvm flutter analyze
fvm flutter test
```

Use `fvm flutter run -d ios` or `-d android` to select a platform explicitly.

The previous implementation remains available in git history and on the
original branch if behavioral reference is ever needed.

## Credits

`lib/core/widgets/thinking_orb/` is a Dart port of
[thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) (MIT © Jakub
Antalik). The dot fields, depth shading, and preset tunings follow that project;
the rendering is reimplemented on Flutter's canvas.
