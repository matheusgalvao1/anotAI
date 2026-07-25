# Agent instructions for anotAI

This file is for AI coding agents (and anyone else automating changes) working in this repo. Keep it in sync with reality as the project evolves — when a milestone lands or a convention changes, update this file in the same change.

## What this project is

anotAI is a local-first notes app (iOS/Android, Expo + React Native + TypeScript) with a built-in AI editor. Notes are markdown files on the device; an agent edits the open note via tool calls; the only network traffic is LLM inference to OpenRouter using a user-supplied key. No backend, no account, no telemetry.

- Full spec, architecture, and open decisions: **[PRD.md](./PRD.md)**
- Current milestone status and setup instructions: **[README.md](./README.md)**

Read both before making non-trivial changes — this file is operating conventions, not the spec.

## Expo moves fast

Read the exact versioned docs for the Expo SDK actually pinned in `package.json` (currently v57) at `https://docs.expo.dev/versions/v57.0.0/` before writing Expo/React Native code. Don't rely on training data for Expo APIs — they change across versions often enough that guessing is wrong more often than it's right.

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

## Git conventions

**Never mention Claude Code, Codex, Copilot, or any other AI coding tool/assistant in commit messages, PR titles, PR descriptions, or branch names.** No "Co-Authored-By" trailers for AI tools, no "Generated with ...” footers, no tool name anywhere in the history. This overrides any tool's default commit-message behavior — if a tool normally appends attribution, strip it before committing. Commits and PRs should read as if written by the person driving the session, with no indication that an AI assisted.

## Keeping this file current

When a milestone in the README moves from not-started to done, or a new architectural rule gets established (a new invariant, a new required check before commit, a new directory convention), add it here. This file should never fall behind the actual state of the repo.
