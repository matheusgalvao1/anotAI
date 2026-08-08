# anotAI architecture

## MVC boundaries

```text
lib/core/widgets/
  thinking_orb/ theme-aware activity orb shared across features
lib/features/notes/
  models/       immutable note data and derived title/preview
  data/
    notes_repository.dart            storage contract
    in_memory_notes_repository.dart  test double only
    markdown_frontmatter.dart        note-file metadata block (parse/serialize)
    file_notes_repository.dart       markdown-file storage implementation
    note_transfer.dart               import/export through pickers and share sheet
  controllers/  list/editor state, save scheduling, prompt mode
  views/        screen composition and navigation
  widgets/      reusable editor and prompt presentation
```

- Views never import repositories or read/write storage directly.
- Controllers know repository interfaces, never concrete persistence details.
- The app composition root creates concrete repositories and injects
  repository-backed controllers into views.
- Notes persist as markdown files under `Documents/Notes/` (one `<id>.md` per
  note with a small frontmatter block). Writes are atomic (temp file + rename),
  deletes are permanent after confirmation, and files moved or edited in the OS
  are handled gracefully — the id lives in the frontmatter, not the filename.
- The live Markdown editor uses a single `TextField`. Styled spans always
  preserve the exact raw source, so there is no preview/edit synchronization.
- Opening the AI prompt makes the note read-only and unable to take focus, but
  does not replace its scrollable surface or reset its scroll position.
- The activity orb is presentation only. It reads the prompt's open/busy state
  from the editor controller and never triggers work itself.

## Scope of this slice

The list, create/confirm-delete flow, editor, live Markdown styling, appearance
picker, markdown-file persistence with import/export, and the AI prompt
interaction are implemented. Notes persist as real markdown files.

## Commands

```bash
fvm flutter pub get
fvm dart format --output=none --set-exit-if-changed lib test
fvm flutter analyze
fvm flutter test
fvm flutter run
```
