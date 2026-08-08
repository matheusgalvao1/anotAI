# Agent instructions for anotAI

Keep this file aligned with the actual project whenever an architectural rule
or required verification step changes.

## Product stage

anotAI is a Flutter notes app for iOS and Android. Notes storage is still
in-memory behind `NotesRepository`, and the AI send action now runs the real
agent loop (ported from the original branch) with provider/model configuration
in Settings. The old implementation is not part of this branch; use git history
or the original branch for historical agent behavior.

## AI agent architecture

The AI feature lives in `lib/features/ai/` and follows the same MVC split as
every other feature, with one addition:

- `models/`: `AiAllowList`/`AiModel`/`AiProvider` (parsed from
  `assets/models.json`), `ModelSelection`, `ProviderId`, `ReasoningMode` —
  pure Dart, headless-testable.
- `data/`: `AiAllowListRepository` (asset), `AiSettingsStore`
  (`flutter_secure_storage` keychain, in-memory for tests), and
  `data/agent/**` — the framework-free agent core ported from the original
  TypeScript: `types`, `loop`, `tools`, `note_store`, `system_prompt`,
  `tokens`, `compaction`, `config`, `transport` (HTTP + SSE), and the four
  adapters under `data/agent/providers/` (`openrouter`, `openai`, `anthropic`,
  `google`). `data/agent_provider_factory.dart` maps a route to an adapter.
- `controllers/`: `SettingsController` (keys + selection) and `AgentController`
  (builds the `Provider` for a turn from the stored selection).

Rules specific to the agent layer:

- The agent core must stay framework-free: it knows none of Flutter or
  `package:http`'s concrete types — `HttpTransport`/`CancellationToken` are
  injected interfaces. Views never import `data/agent`.
- The model list is a hardcoded allow list in `assets/models.json`, NOT a
  fetched catalogue. Adding a model is one JSON entry. The list is grouped by
  provider: the same underlying model is repeated once per provider that can
  serve it (e.g. `gpt-5.6-sol` under OpenAI plus `openai/gpt-5.6-sol` under
  OpenRouter), so choosing an entry is simultaneously choosing the route — a
  provider is a user choice, never a requirement.
- Reasoning modes (`disabled`/`minimal`/`low`/`medium`/`high`/`enabled`) are
  declared per model in the JSON; adapters translate the canonical mode onto
  each provider's own knob (`reasoning.effort`, `thinking` + `output_config`,
  `thinkingConfig`, OpenRouter `reasoning` map).
- OpenAI direct must speak the Responses API (not chat-completions) — the
  `gpt-5.6` family rejects tools on chat-completions.
- `NoteEditorController.submitPrompt` runs the turn with a `NoteStore` backed
  by the live edit buffer; agent-written bodies flow back through
  `onBodyReplaced` so the single visible `TextField` follows the agent without
  a second widget.
- API keys live in the OS keychain via `flutter_secure_storage`; the selected
  model (entry id + reasoning) is stored alongside.

## Flutter is managed by FVM

Always invoke Flutter and Dart through FVM so local and automated checks use the
version pinned in `.fvmrc`:

```bash
fvm flutter pub get
fvm dart format lib test
fvm flutter analyze
fvm flutter test
fvm flutter run
```

Do not install a second global Flutter SDK for this repository.

## Architecture: feature-first MVC

Code under `lib/features/<feature>/` is split by responsibility:

- `models/`: immutable domain data with no widget dependencies.
- `data/`: repository interfaces and their implementations.
- `controllers/`: state and use-case coordination. Controllers may depend on
  repository interfaces, never a concrete storage mechanism.
- `views/`: pages, navigation, focus coordination, and layout.
- `widgets/`: reusable presentation components local to a feature.

Views never access persistence directly. Storage and future provider adapters
must be replaceable without changing view code. Concrete repositories are
created only in the app composition root; views receive already-constructed
controllers. A view must never import from a feature's `data/` directory.

## Editor invariants

The note editor uses one native `TextField` and one scroll position. Do not add
a synchronized preview layer or swap between separate read/edit widgets.

`MarkdownEditingController` styles spans in place while preserving the exact raw
Markdown string. Any parser change must keep `TextSpan.toPlainText()` identical
to its source; the test suite asserts this.

When the AI prompt opens:

- the prompt receives focus and opens the keyboard;
- the note becomes `readOnly` and cannot request focus;
- the same note field and scroll controller remain mounted;
- the note remains scrollable above the resized keyboard viewport;
- closing the prompt explicitly restores the note's ability to take focus.

Scrolling the note must never dismiss the prompt, move focus to the note, or
reset its scroll offset.

## Native projects

`ios/` and `android/` are Flutter project sources and are tracked. Generated
Pods, Gradle state, Flutter ephemeral files, and signing material stay ignored.
Run `fvm flutter create .` only when deliberately regenerating platform shells,
then review every resulting diff.

## Required verification

After any Dart source change:

```bash
fvm dart format --output=none --set-exit-if-changed lib test
fvm flutter analyze
fvm flutter test
```

Changes to focus, scrolling, keyboard insets, themes, plugins, or native config
also require a simulator/device run. A green analyzer alone does not prove those
interactions. The AI wiring is such a path: `flutter_secure_storage` and real
provider calls only behave on a device/simulator — verify with
`fvm flutter build ios --simulator` and a manual turn before assuming a green
suite proves it.

## Git conventions

Commits, branches, and pull requests must describe the product change only. Do
not add coding-assistant attribution, generated-by footers, or automated
co-author trailers.
