# Flutter rewrite architecture

This branch is a clean Flutter implementation. Historical behavior remains
available from the original branch and git history, not as a second runtime in
this working tree.

## MVC boundaries

```text
lib/features/notes/
  models/       immutable note data and derived title/preview
  data/         repository contract and the current in-memory implementation
  controllers/  list/editor state, save scheduling, prompt mode
  views/        screen composition and navigation
  widgets/      reusable editor and prompt presentation
```

- Views never read or write storage directly.
- Controllers know repository interfaces, never concrete persistence details.
- The `NotesRepository` contract is the seam for the next local markdown-file
  implementation.
- The live Markdown editor uses a single `TextField`. Styled spans always
  preserve the exact raw source, so there is no preview/edit synchronization.
- Opening the AI prompt makes the note read-only and unable to take focus, but
  does not replace its scrollable surface or reset its scroll position.

## Scope of this slice

The list, create/delete/restore flow, editor, live Markdown styling, appearance
picker, and AI prompt interaction are implemented. Notes intentionally use an
in-memory repository and the send action intentionally stops at a UI status.
File persistence and AI/provider code belong to the next phases.

## Commands

```bash
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter run
```
