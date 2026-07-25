# Agent instructions for anotAI

This file is for AI coding agents (and anyone else automating changes) working in this repo. Keep it in sync with reality as the project evolves — when a milestone lands or a convention changes, update this file in the same change.

## What this project is

anotAI is a local-first notes app (iOS/Android, Expo + React Native + TypeScript) with a built-in AI editor. Notes are markdown files on the device; an agent edits the open note via tool calls; the only network traffic is LLM inference to OpenRouter using a user-supplied key. No backend, no account, no telemetry.

- Full spec, architecture, and open decisions: **[PRD.md](./PRD.md)**
- Current milestone status and setup instructions: **[README.md](./README.md)**

Read both before making non-trivial changes — this file is operating conventions, not the spec.

## Expo moves fast

Read the exact versioned docs for the Expo SDK actually pinned in `package.json` (currently v57) at `https://docs.expo.dev/versions/v57.0.0/` before writing Expo/React Native code. Don't rely on training data for Expo APIs — they change across versions often enough that guessing is wrong more often than it's right.

## The Expo entry shell lives in src/app/, not at the repo root

`App.tsx`, `index.ts`, and `assets/` live under `src/app/` to keep the repo root down to config and docs. `package.json`'s `"main"` points at `src/app/index.ts`; `app.json`'s icon paths point at `src/app/assets/`. `app.json`, `package.json`, and the tsconfig/jest configs stay at the actual repo root — Expo CLI and npm only look for those there.

**A directory literally named `app` anywhere in the tree — including nested, as `src/app/`— gets picked up by Expo's own tooling as a potential Expo Router root**, logged as `Using src/app as the root directory for Expo Router`. This is harmless as long as `expo-router` isn't a dependency and `"main"` still points explicitly at our own `index.ts` (both true today), but it's exactly the naming collision to watch for if `expo-router` ever gets adopted (PRD §10) — that transition would need to actually embrace this directory as a router root, or the folder would need renaming first.

## Architecture invariant: the agent core stays framework-free

`src/agent/` must never import React, React Native, or Expo APIs. It's plain TypeScript, tested headless in Jest with no simulator and no network (see `src/agent/providers/mock.ts`). This is deliberate — it's what makes the hardest part of the app (the loop, tool-calling, compaction) fast to iterate on and cheap to test. If a change to `src/agent/` seems to need a React or RN import, that's a sign the abstraction boundary is being violated — push the platform-specific bit (file I/O, secure storage, fetch) behind an interface instead (see `NoteStore`, `Provider`).

## Commands

```bash
npm test          # agent core Jest suite — run this after any src/agent/ change
npm run test:watch
npx tsc --noEmit  # type-check the app (uses tsconfig.json, excludes *.test.ts)
npm start         # Expo dev server
npm run ios / android / web
```

`src/agent/**/*.test.ts` is type-checked separately via `tsconfig.jest.json` (it needs Jest's ambient types, which the app's own `tsconfig.json` deliberately excludes). If you add a new tsconfig-affecting setting, check both configs still resolve cleanly.

## Environment gotchas (all found the hard way getting M1 running on an iOS simulator)

- **Never locate this repo inside `~/Downloads`, `~/Desktop`, `~/Documents`, or iCloud Drive.** macOS requires the terminal app to have "Full Disk Access" (or Files & Folders access) to run FSEvents on those specific folders; without it, `watchman watch-project` fails with `FSEventStreamStart failed`, and Metro falls back to Node's `fs.watch`, which then dies with `EMFILE: too many open files, watch` on a tree this size. Keep the repo somewhere ordinary, e.g. `~/Developer/`.
- **`react-native-get-random-values` must be the first import in `src/app/index.ts`**, before anything else. `ulid` (used by `src/notes/noteRepository.ts`) needs `crypto.getRandomValues`, which Hermes doesn't provide natively; the polyfill has to run before any module that might call `ulid()` is evaluated.
- **`punycode` is a real npm dependency here, not dead weight.** `react-native-markdown-display` → `markdown-it` does `require('punycode')` expecting Node's core module, which doesn't exist in the RN runtime. Installing the userland `punycode` package lets Metro resolve it instead of failing the whole iOS bundle. Don't remove it as "unused."
- **`expo-file-system`'s `Directory`/`File` classes do not work on web** (`this.validatePath is not a function` at runtime) despite the bundle compiling cleanly — web is a dev convenience, not a target platform (PRD §1), so this is a known, accepted gap, not a bug to chase.
- If `expo start --ios` prints `Watchman is installed but was likely not enabled when starting Metro, try starting your project again` — that's Metro's own recovery routine (it just ran `watchman watch-del-all` for you) telling you, literally, to run the same command again. It usually works the second time.

`npm test` never calls a real model. `*.live.test.ts` files (run via `npm run test:live`, config in `jest.live.config.js`) hit the real OpenRouter API and are excluded from `npm test` on purpose — never fold them into the default suite or CI. They read credentials from `.env` (copy `.env.example`) via `dotenv/config`, loaded only in `jest.live.config.js` — never wire `.env` loading into the main suite or the app itself; the shipped app reads keys from the OS keychain, never env vars (PRD §8). The env var convention is `<PROVIDER>_API_KEY` / `<PROVIDER>_DEFAULT_MODEL`, matching a `Provider.id`, so it extends as more providers land (PRD §14.1).

## Git conventions

**Never mention Claude Code, Codex, Copilot, or any other AI coding tool/assistant in commit messages, PR titles, PR descriptions, or branch names.** No "Co-Authored-By" trailers for AI tools, no "Generated with ...” footers, no tool name anywhere in the history. This overrides any tool's default commit-message behavior — if a tool normally appends attribution, strip it before committing. Commits and PRs should read as if written by the person driving the session, with no indication that an AI assisted.

## Keeping this file current

When a milestone in the README moves from not-started to done, or a new architectural rule gets established (a new invariant, a new required check before commit, a new directory convention), add it here. This file should never fall behind the actual state of the repo.
