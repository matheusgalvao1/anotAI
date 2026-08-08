# anotAI

anotAI is a local-first notes app for iOS and Android. It feels like a fast,
ordinary phone notes app and adds an AI instruction surface that edits the
open note directly.

## Features

- note list with create, swipe-to-delete, and undo;
- one editable, scrollable note surface;
- live Obsidian-style Markdown formatting without a preview toggle;
- light, dark, and system appearance modes;
- an animated thought orb that opens a focused AI instruction field, then sits
  beside it and switches while an instruction is being worked on;
- a note that stays scrollable but becomes read-only while that field is open;
- an AI editing agent that runs real tool-calling turns: read, rewrite, and
  patch the open note with a hardcoded model allow list served by OpenAI,
  Anthropic, Google, or OpenRouter — plus per-model reasoning-effort selection;
- provider API keys kept in the OS keychain, never in app storage.

Notes currently live in an in-memory repository and reset when the app
restarts. Local markdown-file persistence is the next implementation phase.

## Architecture

The app follows feature-first MVC boundaries:

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
  features/ai/
    models/                    allow-list types and model selection
    data/                      agent core (framework-free loop + provider
                               adapters), settings/keychain stores
    controllers/               settings + agent controllers
  features/settings/
    controllers/
    views/
```

The agent core is deliberately framework-free: views never touch the loop or
the provider adapters, and the model allow list in `assets/models.json` is the
single place a new model gets added.

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

## License

[MIT](LICENSE) © 2026 Matheus Galvão

## Credits

`lib/core/widgets/thinking_orb/` is a Dart port of
[thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) (MIT © Jakub
Antalik). The dot fields, depth shading, and preset tunings follow that project;
the rendering is reimplemented on Flutter's canvas.