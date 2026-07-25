# anotAI

A local-first notes app for iOS and Android with a built-in AI editor. Notes are plain markdown files on the device. A floating prompt bar lets you ask an AI to edit the note you have open — the AI acts on the note directly; it doesn't chat.

The agent — the loop that talks to the model and executes its tool calls — runs entirely inside the app. The only network traffic is LLM inference, sent directly to [OpenRouter](https://openrouter.ai) using an API key you supply. There is no backend, no account, and no telemetry.

Full product spec: **[PRD.md](./PRD.md)**.

## Status

Building in the milestone order described in the PRD, agent core first because it's where the real risk lives and it's far cheaper to get right without a UI attached.

- [x] **M2 — Agent runtime, headless.** Loop, tools, provider interface, compaction. Pure TypeScript, tested in Jest with no simulator and no network. → [`src/agent/`](./src/agent)
- [ ] **M1 — Notes app, no AI.** List, editor, file storage, undo.
- [ ] **M3 — Wire it up.** Prompt bar, status line, soft-lock, turn-level undo, Settings.
- [ ] **M4 — Change highlighting.** Diff-based highlight of the last agent turn.
- [ ] **M5 — Harden.** Full error matrix, cross-model testing, physical-device validation, store prep.

(M2 before M1 is deliberate — see PRD §11.)

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

App.tsx, app.json, index.ts   Expo app shell (UI not yet built — see Status)
PRD.md                        full product requirements and architecture doc
```

## Getting started

```bash
npm install
npm test          # agent core test suite (fast, no simulator)
npm start         # Expo dev server — once the UI exists
```

Other scripts: `npm run ios`, `npm run android`, `npm run web`, `npm run test:watch`.

There's no UI yet (see Status above), so `npm test` is the meaningful command today.

## Environment variables

```bash
cp .env.example .env
# then fill in OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL
```

`.env` is gitignored and is a **dev/test-time convenience only** — it's read by `npm run test:live` (below), nothing else. The shipped app never reads API keys from env vars; a user's key is stored in the OS keychain at runtime, set via the in-app Settings screen (PRD §8). `.env.example` documents the naming convention (`<PROVIDER>_API_KEY` / `<PROVIDER>_DEFAULT_MODEL`) so it extends cleanly as more providers land (PRD §14.1).

## Testing philosophy

The agent core has zero dependency on React or React Native, specifically so it can be tested in Node with no simulator and no network — see PRD §11 and §12 for why this ordering matters. `src/agent/providers/mock.ts` provides a scripted `Provider` so loop behavior (tool-call chaining, the forced-rewrite threshold, the iteration cap, cancellation, compaction fallback) is fully deterministic in tests.

`npm test` never talks to a real model — it's all against the mock provider. `OpenRouterProvider` (streaming SSE, tool-call parsing) has not been validated against the live API and needs to be before it's trusted; do that with:

```bash
npm run test:live
```

This runs one real turn against OpenRouter (asks the model to add an item to a short list) and prints the resulting note body and status line for you to eyeball. Without `OPENROUTER_API_KEY`/`OPENROUTER_DEFAULT_MODEL` set in `.env`, it skips with instructions instead of failing. It's excluded from `npm test` and from any future CI so it never runs automatically or spends money by accident. It also still needs validation on physical iOS/Android hardware — RN's fetch-streaming support has historically been fragile, and this test only proves the adapter works in Node.

## License

MIT — see [LICENSE](./LICENSE).
