# Agent instructions for anotAI

Keep this file aligned with the actual project whenever an architectural rule
or required verification step changes.

## Product stage

anotAI is being rewritten as a Flutter notes app for iOS and Android. This
milestone covers the notes UI and interaction model only. Storage is currently
in-memory, and the AI send action is a deliberate placeholder.

The old implementation is not part of this branch. Use git history or the
original branch when historical behavior is useful; do not restore old project
files here.

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
interactions.

## Git conventions

Commits, branches, and pull requests must describe the product change only. Do
not add coding-assistant attribution, generated-by footers, or automated
co-author trailers.
