# anotAI

A local-first notes app for iOS and Android with a built-in AI editor. Notes are plain markdown files on the device. A floating prompt bar lets you ask an AI to edit the note you have open — the AI acts on the note directly; it doesn't chat.

The agent — the loop that talks to the model and executes its tool calls — runs entirely inside the app. The only network traffic is LLM inference, sent directly to [OpenRouter](https://openrouter.ai) using an API key you supply. There is no backend, no account, and no telemetry.

Full product spec: **[PRD.md](./PRD.md)**.

## Status

Building in the milestone order described in the PRD, agent core first because it's where the real risk lives and it's far cheaper to get right without a UI attached.

- [x] **M2 — Agent runtime, headless.** Loop, tools, provider interface, compaction. Pure TypeScript, tested in Jest with no simulator and no network. → [`src/agent/`](./src/agent)
- [x] **M1 — Notes app, no AI.** List, editor, file storage, trash, undo. → [`src/notes/`](./src/notes), [`src/screens/`](./src/screens). Confirmed on an iOS simulator: create/edit/delete/swipe-to-delete-with-undo/manual undo-redo all manually tested and working.
- [x] **M3 — Wire it up.** `runTurn()` is connected to a real editor: Settings screen (OpenRouter key + model, OS keychain, live validation), a FAB-driven prompt composer (soft-lock while a turn runs, turn-level undo, error messages mapped from the provider's error kinds). **Confirmed working end-to-end against the live API** — an actual AI-edited note exists on the test simulator. Also includes a full design pass beyond M3's original scope: light/dark/system theming with an orange accent (persisted, `src/theme/`), vector icons throughout, and the FAB composer's current design (Undo/Redo stacked above the FAB; the FAB itself becomes the send button when the composer is open).
- [ ] **M4 — Change highlighting.** Diff-based highlight of the last agent turn.
- [ ] **M5 — Harden.** Full error matrix, cross-model testing, physical-device validation, store prep.

(M2 before M1 is deliberate — see PRD §11.)

**Editor decision:** M1 uses a plain `TextInput` + a toggled markdown preview, not live inline formatting. Three candidates were spiked and compared — see PRD §7.2 and §12. Live inline formatting (à la `react-native-live-markdown`) is the confirmed target for a later polish pass, pending a dev-client build to validate it on real iOS/Android (it doesn't run in Expo Go).

## Stack

- **Expo** (React Native) + TypeScript, strict mode
- **Jest** + `ts-jest` for the agent core — runs headless, no `jest-expo`/simulator required
- **OpenRouter** as the only LLM provider in v1, behind a `Provider` interface designed so additional providers (OpenAI, Anthropic, Google — see PRD §14.1) are additive, not a rewrite

## Project layout

```
src/agent/              agent core — plain TypeScript, no React/RN imports
  types.ts              canonical message format + Provider interface
  config.ts              tunable constants (iteration cap, thresholds, timeout)
  tools.ts               read_note / rewrite_note / patch_note
  systemPrompt.ts         per-turn system prompt (inline vs. read_note mode)
  compaction.ts           context summarization once a session exceeds 50k tokens
  loop.ts                 runTurn() — the agent loop
  noteStore.ts            NoteStore interface + in-memory implementation for tests
  providers/
    mock.ts               scripted Provider for deterministic tests
    openrouter.ts          real adapter — streaming SSE, OpenAI-shaped wire format
  *.test.ts               Jest suite for the above

src/notes/               note storage + pure helpers, no AI
  noteRepository.ts      file-backed CRUD; wraps every FS call as NoteStoreError
  agentNoteStore.ts       adapts noteRepository to the agent's single-note NoteStore interface
  title.ts                derives title + preview from body (never stored)
  undoStack.ts            snapshot undo/redo, pushed at debounced save boundaries
  trashName.ts            encodes deletion time in trashed filenames (mtime is not a usable proxy)
  relativeTime.ts          list-row timestamp formatting
  *.test.ts               Jest suite for the pure pieces above

src/settings/            OpenRouter credentials, dev/test-only .env aside
  secureSettings.ts       API key + model, OS keychain (expo-secure-store)
  validateApiKey.ts       one cheap request to confirm a key/model pair works

src/theme/               light/dark/system theming, orange accent
  palette.ts              light/dark color tokens
  ThemeContext.tsx        provider + useTheme(), persists preference via AsyncStorage

src/screens/             app UI
  NoteListScreen.tsx      flat list, swipe-to-delete + undo snackbar, create FAB
  NoteEditorScreen.tsx    presentation only — composes the two hooks below
  useNoteSession.ts       one note's body: debounced saves, lifecycle flush, undo/redo, save errors
  useAgentTurn.ts         one agent turn: credentials, provider, history, cancel/timeout, error mapping
  AgentFab.tsx            floating Undo/Redo/Ask-AI cluster; FAB becomes the send button when open
  SettingsScreen.tsx      API key/model, Appearance (Light/Dark/System), About

src/app/                 Expo entry shell — plain component-state navigation (no router yet)
  App.tsx                 root component, screen switch, ThemeProvider
  index.ts                registerRootComponent; crypto polyfill must stay the first import
  assets/                 app icons

app.json, package.json        reference src/app/ paths directly (Expo/npm require these at repo root)
PRD.md                        full product requirements and architecture doc
```

## Getting started

```bash
npm install
npm test          # unit tests: agent core + notes logic (fast, no simulator)
npm run ios       # or: npm run android / npm run web
```

Other scripts: `npm run test:watch`.

### Running on a device

A successful start prints `iOS Bundled <n>ms src/app/index.ts` with ~1050 modules. That line is worth waiting for rather than skimming past — it's the proof every native module resolved in the React Native runtime, which is where this project's runtime failures have actually come from (see PRD §12).

**Keep this repo out of `~/Downloads`, `~/Desktop`, `~/Documents`, and iCloud Drive.** macOS gates FSEvents (what Watchman/Metro use for file-watching) behind a "Full Disk Access" permission for those specific folders; without it, Metro dies with `EMFILE: too many open files, watch` and no clear reason why. Clone/keep this somewhere ordinary, e.g. `~/Developer/anotai`.

**Watchman is required, not an optimization.** Without it Metro falls back to Node's `fs.watch`, which cannot watch a tree this size and dies with `EMFILE: too many open files, watch`. That error is almost always about watchman, not about your file-descriptor limit — raising `ulimit -n` doesn't help, and neither does disabling watchman in a `metro.config.js`.

Two failures look identical (`EMFILE`) and have different fixes:

| Symptom | Fix |
|---|---|
| `Watchman is installed but was likely not enabled when starting Metro, try starting your project again` | Not really an error — Metro's own recovery routine telling you to run the command again. Usually works the second time. |
| `watchman watch-project .` fails with `FSEventStreamStart failed` — including on `/private/tmp` | **Reboot.** The broken state is in the kernel; restarting the daemon doesn't clear it. Don't grant Full Disk Access, don't reinstall watchman — neither helps. |

`AGENTS.md` has the full diagnosis and the list of workarounds that were tried and don't work, so nobody has to rediscover them.

See `AGENTS.md`'s "Environment gotchas" section for the full list of environment-specific fixes already applied (crypto polyfill, a Node-core-module shim) — you shouldn't need to redo any of them, they're already in the repo.

## Environment variables

```bash
cp .env.example .env
# then fill in OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL
```

`.env` is gitignored and is a **dev/test-time convenience only** — it's read by `npm run test:live` (below), nothing else. The shipped app never reads API keys from env vars; a user's key is stored in the OS keychain at runtime, set via the in-app Settings screen (PRD §8). `.env.example` documents the naming convention (`<PROVIDER>_API_KEY` / `<PROVIDER>_DEFAULT_MODEL`) so it extends cleanly as more providers land (PRD §14.1).

## Testing philosophy

The agent core has zero dependency on React or React Native, specifically so it can be tested in Node with no simulator and no network — see PRD §11 and §12 for why this ordering matters. `src/agent/providers/mock.ts` provides a scripted `Provider` so loop behavior (tool-call chaining, the forced-rewrite threshold, the iteration cap, cancellation, compaction fallback) is fully deterministic in tests.

`npm test` never talks to a real model — it's all against the mock provider. `OpenRouterProvider` also has deterministic unit tests (`src/agent/providers/openrouter.test.ts`) covering the wire-format cases a happy-path request never reaches: events fragmented across chunk boundaries, CRLF separators, streams that end without a terminator, tool calls closed with an unexpected `finish_reason`, truncated tool-call JSON, and HTTP status→error-kind mapping. `fetch` is injected there rather than stubbed globally.

Separately, it **has** been validated against the live API, both via the script below and via a real AI-edited note in the app on an iOS simulator:

```bash
npm run test:live
```

This runs one real turn against OpenRouter (asks the model to add an item to a short list) and prints the resulting note body and status line for you to eyeball. Without `OPENROUTER_API_KEY`/`OPENROUTER_DEFAULT_MODEL` set in `.env`, it skips with instructions instead of failing. It's excluded from `npm test` and from any future CI so it never runs automatically or spends money by accident.

**What the live test does not prove:** it runs under Node, where `globalThis.fetch` is undici, so it exercises a different transport than the app. It validates OpenRouter's wire format, not React Native's — which is why the app now passes `expo/fetch` into `OpenRouterProvider` explicitly (RN's own `fetch` cannot stream at all) and why the SSE edge cases are covered deterministically rather than by the live run. Still open: validation on **physical** iOS/Android hardware, not just simulator.

## License

MIT — see [LICENSE](./LICENSE).
