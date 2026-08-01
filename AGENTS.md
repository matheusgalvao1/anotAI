# Agent instructions for anotAI

This file is for AI coding agents (and anyone else automating changes) working in this repo. Keep it in sync with reality as the project evolves — when a milestone lands or a convention changes, update this file in the same change.

## What this project is

anotAI is a local-first notes app (iOS/Android, Expo + React Native + TypeScript) with a built-in AI editor. Notes are markdown files on the device; an agent edits the open note via tool calls; the only network traffic is LLM inference to OpenRouter using a user-supplied key. No backend, no account, no telemetry.

- Full spec, architecture, milestones, and open decisions: **[PRD.md](./PRD.md)**
- Setup and instructions for running the app: **[README.md](./README.md)**

Read both before making non-trivial changes — this file is operating conventions, not the spec.

## Expo moves fast

Read the exact versioned docs for the Expo SDK actually pinned in `package.json` (currently v57) at `https://docs.expo.dev/versions/v57.0.0/` before writing Expo/React Native code. Don't rely on training data for Expo APIs — they change across versions often enough that guessing is wrong more often than it's right.

## The Expo entry shell lives in src/app/, not at the repo root

`App.tsx`, `index.ts`, and `assets/` live under `src/app/` to keep the repo root down to config and docs. `package.json`'s `"main"` points at `src/app/index.ts`; `app.json`'s icon paths point at `src/app/assets/`. `app.json`, `package.json`, and the tsconfig/jest configs stay at the actual repo root — Expo CLI and npm only look for those there.

**A directory literally named `app` anywhere in the tree — including nested, as `src/app/`— gets picked up by Expo's own tooling as a potential Expo Router root**, logged as `Using src/app as the root directory for Expo Router`. This is harmless as long as `expo-router` isn't a dependency and `"main"` still points explicitly at our own `index.ts` (both true today), but it's exactly the naming collision to watch for if `expo-router` ever gets adopted (PRD §10) — that transition would need to actually embrace this directory as a router root, or the folder would need renaming first.

## Architecture invariant: the agent core stays framework-free

`src/agent/` must never import React, React Native, or Expo APIs. It's plain TypeScript, tested headless in Jest with no simulator and no network (see `src/agent/providers/mock.ts`). This is deliberate — it's what makes the hardest part of the app (the loop, tool-calling, compaction) fast to iterate on and cheap to test. If a change to `src/agent/` seems to need a React or RN import, that's a sign the abstraction boundary is being violated — push the platform-specific bit (file I/O, secure storage, fetch) behind an interface instead (see `NoteStore`, `Provider`, `FetchLike`).

Verify with: `grep -rn "from \"react\|from \"expo\|react-native" src/agent/` — that must return nothing.

**The invariant covers implicit dependencies too, not just import statements.** `OpenRouterProvider` used to call the ambient global `fetch`, which looked framework-free and wasn't: RN's own `fetch` is `whatwg-fetch` over XHR and its `Response` has no `body` property at all, so SSE can't be read from it. The app only worked because Expo SDK 57 replaces `globalThis.fetch` with its streaming implementation (`node_modules/expo/src/winter/runtime.native.ts`, gated on `EXPO_PUBLIC_USE_RN_FETCH`) — an invisible side effect the core had no way to declare or test. `fetch` is now injected via `OpenRouterProviderOptions.fetch`, and `src/screens/useAgentTurn.ts` passes `expo/fetch` explicitly. If you add a provider, inject its transport the same way.

## Two error classes, deliberately kept apart

- **Recoverable, model-facing:** malformed tool arguments. Validated at the tool boundary in `src/agent/tools.ts` and returned as `{ok: false, error}` so the model can correct itself on the next iteration. These must never throw — a thrown validation error kills the whole turn and surfaces a raw JS message to the user.
- **Not recoverable, user-facing:** storage failures. `src/notes/noteRepository.ts` wraps every filesystem call and throws `NoteStoreError`; `runTurn` rethrows it rather than reporting it to the model, and the editor shows a persistent banner. PRD §14's error matrix calls silent data loss the worst outcome in the app, so nothing on this path may be swallowed or auto-dismissed.

## `ToolCall.providerData` is required plumbing, not an optimisation

A provider may sign the tool calls it issues and then reject a conversation that replays one without the signature. `ToolCall.providerData` is the opaque slot for that state: the adapter that produced a call is the only thing allowed to read it, and the loop and tools carry it untouched.

Gemini is the live case — a `functionCall` part comes with a `thoughtSignature` **beside** it (a sibling key, not a field inside `functionCall`), and omitting it on replay fails the *next* request with "Function call is missing a thought_signature in functionCall parts". Note the failure mode: it lands one step after the code that caused it, so it reads as a loop or model bug rather than a serialisation one. The Gemini adapter passed every deterministic test it had while doing this.

Two rules follow. **Round-trip state must be captured at the same time as the call, in the same adapter** — anything reconstructed later is a guess. And **`providerData` must be read back defensively** (`googleCallState`), never cast: it's `unknown` by design, history can be rehydrated from storage, and the user can switch providers mid-session, so an adapter can be handed a shape another adapter wrote.

If a new provider needs the same treatment, it gets its own state type and its own guard — don't widen Gemini's.

## Anything user-facing about a provider takes the provider's name as a parameter

`describeTurnError` in `src/screens/useAgentTurn.ts` hard-coded "OpenRouter" in five messages, so once four providers were wired up an Anthropic 404 told the user to check the model name on OpenRouter. A wrong provider name sends someone to the wrong Settings field, which is worse than a vague message. The name comes from `describeProvider(id).label`.

Related: **quote the provider's own error text after your advice, don't replace it.** These messages are wildly uneven — Anthropic's entire message for an unknown model is `model: claude-haiku-4.5` — so neither showing it alone nor hiding it works. Advice first, provider text in parentheses.

## A model id is a config value, and every provider spells them differently

Four conventions, all of which have produced a failed run here: OpenRouter usually wants a provider prefix (`openai/gpt-4o-mini`), OpenAI never does, Anthropic dashes its version numbers and never dots them (`claude-haiku-4-5-20251001`, so `claude-haiku-4.5` 404s), and Gemini ids must omit the `models/` prefix its own catalogue returns. `.env.example` documents each one at the variable that needs it. When a live test fails on a model id, check the convention before the adapter.

## OpenAI speaks the Responses API; OpenRouter speaks chat-completions

`openai.ts` posts to **`/v1/responses`**, and is not the `openaiCompatible.ts` implementation. That split is deliberate and shouldn't be "simplified" back into one.

The reason is that `/v1/chat/completions` cannot serve every OpenAI model: some reject function tools there outright (`Function tools with reasoning_effort are not supported for <model> in /v1/chat/completions`). Which ones is **not predictable from the id** — probed live, `o1`, `o3`, `o3-mini`, `o4-mini`, `gpt-5`, `gpt-5-mini`, `gpt-4o-mini` and `gpt-4.1-mini` all accept tools on chat-completions, and only `gpt-5.6-luna` refused. `/v1/models` publishes no capability flag either. Every one of them accepts tools on `/v1/responses`, so the adapter speaks only that and the question stops existing. Don't reintroduce `reasoning_effort` to work around it — models that don't want it reject it as an unknown parameter.

Twice now, one model's behaviour has been generalised into a rule about "reasoning models", and the second time that rule reached the code and hid working models from the picker. **Capability is never inferred from a model id.** `validateApiKey` sends a real tool and lets the provider answer; `classifyHttpError` maps a refusal to `no_tool_support` for anything selected without validating. Any "does this model work" check must carry a tool — answering a plain prompt proves nothing about the only thing this app ever asks a model to do. If you want to know whether a model works, probe it.

Three Responses-specific things that will bite:

- **`store: false`, and reasoning items must be replayed.** The API otherwise keeps the conversation server-side for `previous_response_id`; this app has no backend by design (PRD §1). Opting out means the reasoning item that precedes a tool call has to travel back in the next request's `input`, which needs `include: ["reasoning.encrypted_content"]` on the way out. This is the same class of problem as Gemini's `thoughtSignature` and uses the same `ToolCall.providerData` slot — with **its own state type and guard** (`ResponsesCallState`), not a widened `GoogleCallState`.
- **Dropping the reasoning item does not error.** Unlike Gemini, which fails the next request loudly, OpenAI accepts the replay and the model returns an **empty final message** — so the turn "succeeds" having said nothing. Verified both ways against the live API. A passing turn is not evidence this is right; the round-trip tests in `openai.test.ts` are.
- **An unknown model is a 400 here, not a 404.** "The requested model 'x' does not exist." `isModelNotFoundError` in `transport.ts` exists for that, and it is checked *after* the tool-support heuristic because a tool refusal names a model too.

## Commands

```bash
npm test                              # agent core + notes Jest suite — run after any src/ change
npm run test:watch
npx tsc --noEmit                      # type-check the app (tsconfig.json, excludes *.test.ts)
npx tsc --noEmit -p tsconfig.jest.json  # type-check the tests
npx expo-doctor                       # dependency/config sanity — run after any dependency change
npm start                             # Expo dev server
npm run ios / android / web
```

Test files are type-checked separately via `tsconfig.jest.json` (they need Jest's ambient types, which the app's own `tsconfig.json` deliberately excludes). **Both `tsc` invocations must exit 0.** `tsconfig.jest.json` once combined `moduleResolution: "node"` with `customConditions: []`, a contradiction that made `tsc -p tsconfig.jest.json` fail on the config itself — `npm test` still type-checked fine through ts-jest, so the broken command went unnoticed. It uses `moduleResolution: "bundler"` now; `"node"`/node10 is also deprecated and stops working in TypeScript 7.

Jest 30 is paired with ts-jest 29 **on purpose** — ts-jest 29.4 declares `jest: "^29.0.0 || ^30.0.0"`, so this is supported, not a mismatch. Expo SDK 57 separately pins jest ~29 for `jest-expo`, which this project doesn't use; that's recorded in `package.json`'s `expo.install.exclude` so `expo-doctor` stays green. Don't "fix" it by downgrading.

## Environment gotchas (all found the hard way getting the app running on a simulator and a device)

- **`ios/` holds absolute paths, so moving the checkout breaks the native build.** CocoaPods writes the repo's absolute path into ~200 generated files under `ios/`. Relocating the repo after a build fails with `virtual filesystem overlay file '<old path>/ios/Pods/React-Core-prebuilt/React-VFS.yaml' not found` — an error naming a directory that no longer exists, which reads as corruption rather than a stale path. Recovery is `rm -rf ios/build node_modules/expo-modules-jsi/apple/.DerivedData`, then `pod install --project-directory=ios`. **Then check `HERMES_CLI_PATH`** in `ios/Pods/Target Support Files/Pods-anotAI/*.xcconfig`: `pod install` restores every other path correctly but regenerates that one from a cache and can reinstate the old location, which breaks release bundling later and nothing before it.
- **`expo run:ios` prints "Build Succeeded" and can still fail afterwards**, during install or launch — a locked device is the common one (`Cannot launch anotAI on <device> because the device is locked`), and it lands after a full compile. Read the last line, not the encouraging one in the middle. Do not pipe the command through `tee` to capture a log: the shell reports the *pipe's* exit status, so a failed build exits 0 and looks like a pass. Redirect instead (`> build.log 2>&1`).
- **A physical iOS device needs Developer Mode on and the screen unlocked** before `expo run:ios --device` reaches its install step. `xcrun devicectl list devices` shows whether the device is paired; `xcrun devicectl device info details --device <id>` reports `developerModeStatus`. Neither the unlock nor the "Trust this computer" prompt can be driven from a shell.

- **Never locate this repo inside `~/Downloads`, `~/Desktop`, `~/Documents`, or iCloud Drive.** macOS requires the terminal app to have "Full Disk Access" (or Files & Folders access) to run FSEvents on those specific folders; without it, `watchman watch-project` fails with `FSEventStreamStart failed`, and Metro falls back to Node's `fs.watch`, which then dies with `EMFILE: too many open files, watch` on a tree this size. Keep the repo somewhere ordinary, e.g. `~/Developer/`.
- **`react-native-get-random-values` must be the first import in `src/app/index.ts`**, before anything else. `ulid` (used by `src/notes/noteRepository.ts`) needs `crypto.getRandomValues`, which Hermes doesn't provide natively; the polyfill has to run before any module that might call `ulid()` is evaluated.
- **`punycode` is a real npm dependency here, not dead weight.** `react-native-markdown-display` → `markdown-it` does `require('punycode')` expecting Node's core module, which doesn't exist in the RN runtime. Installing the userland `punycode` package lets Metro resolve it instead of failing the whole iOS bundle. Don't remove it as "unused."
- **`expo-file-system`'s `Directory`/`File` classes do not work on web** (`this.validatePath is not a function` at runtime) despite the bundle compiling cleanly — web is a dev convenience, not a target platform (PRD §1), so this is a known, accepted gap, not a bug to chase.
- If `expo start --ios` prints `Watchman is installed but was likely not enabled when starting Metro, try starting your project again` — that's Metro's own recovery routine (it just ran `watchman watch-del-all` for you) telling you, literally, to run the same command again. It usually works the second time.
- **Watchman is effectively mandatory here; the fallback watcher cannot substitute for it.** When watchman is unavailable Metro falls back to Node's `fs.watch` and dies with `Error: EMFILE: too many open files, watch` at `FSWatcher._handle.onchange`. If you see EMFILE, repair watchman — don't chase the fd limit. These three workarounds were each tried and each still EMFILEs, so don't spend time on them again:
  - raising the fd limit (`ulimit -n 65536`)
  - `resolver.useWatchman = false` in a `metro.config.js` (Metro's own watcher is the one running out, so opting out of watchman explicitly changes nothing)
  - `EXPO_NO_TYPESCRIPT_SETUP=1` (the EMFILE lands later, after `xcrun simctl list devices`, so Expo's TypeScript-setup watcher isn't the culprit despite appearing just above it in the debug log)
- **If `watchman watch-project` fails with `FSEventStreamStart failed`, reboot. That is the fix — try it first.** This was diagnosed the long way once; don't repeat it. FSEvents state that breaks this way lives in the kernel, and nothing short of a restart clears it — `watchman shutdown-server` does not, because the daemon is not what is broken.
  - **Diagnostic first, so you fix the right thing:** run `watchman watch-project /private/tmp`. If that *also* fails, the failure is daemon-wide and a reboot is the answer. If only certain paths fail, it is the TCC/`~/Downloads` case above instead, which is genuinely path-specific.
  - **Do not grant Full Disk Access.** An earlier revision of this file recommended it. That was a guess from a wrong model of the failure, and it was wrong: FSEvents was failing on `/private/tmp`, which no privacy setting protects. A reboot fixed it with no permission grant of any kind. Don't hand a file-watcher blanket disk access to work around this.
  - Also tried and useless here: `brew reinstall watchman` (re-pours an identical bottle), `prefer_split_fsevents_watcher: true` in `.watchmanconfig` (fails with `folly::BrokenPromise`), and `{"watcher": "kqueue"}` — that last one *does* bypass FSEvents and starts crawling, then dies on `opendir -> Too many open files` because it wants ~61,484 fds against a `kern.maxfilesperproc` of 61,440. Missing by 44 descriptors is not a margin worth engineering around.
  - Suspect a plain `brew upgrade` as the trigger. A long-running daemon keeps working on its old binary, so a replacement only takes effect at the next restart — which makes the breakage look like whatever you did just before it, rather than an upgrade from hours earlier. `ls -l /opt/homebrew/bin/watchman` dates the swap.
- **`userInterfaceStyle` in `app.json` must stay `"automatic"`.** The app ships a Light/Dark/**System** picker built on `useColorScheme()`; setting this to `"light"` (Expo's documented default) forces light appearance app-wide and makes the System option permanently resolve to light. This is invisible in Expo Go, which supplies its own `Info.plist` — it only shows up in a dev or production build. `expo-system-ui` is a required dependency for appearance styles to work on Android builds.
- **`expo-font` is a required peer dependency of `@expo/vector-icons`**, not optional. Without it the app can crash outside Expo Go. `npx expo-doctor` catches this class of thing; run it after any dependency change.

## Verifying a change actually runs

A clean `tsc` plus a green suite has been insufficient here three times over — `punycode`, the `crypto.getRandomValues` polyfill, and `expo-file-system` on web all compiled fine and failed at runtime. Anything touching native modules, the transport, or app config needs a simulator run.

```bash
npm run ios                                    # wait for: iOS Bundled <n>ms src/app/index.ts (~1050 modules)
xcrun simctl io booted screenshot shot.png     # then actually look at it — a blank frame is a failed launch
```

**A successful bundle is itself a real result.** It proves every native module resolves in the RN runtime, which is exactly the class of failure listed above. Don't treat it as mere preamble to the interesting part.

**You cannot tap.** `osascript`/System Events UI scripting fails with `-1719 not allowed assistive access`, and that needs a GUI grant an agent session can't perform. So don't plan a verification around synthetic taps — inspect state instead, which is more reliable anyway:

```bash
C=$(xcrun simctl get_app_container booted host.exp.Exponent data)
E="$C/Documents/ExponentExperienceData/@anonymous/anotai-"*
ls -lT "$E"/notes/*.md          # mtimes prove *when* a write happened — use them to attribute a change
cat "$E"/notes/<id>.md          # the note as the app actually persisted it
cat "$E"/RCTAsyncLocalStorage/manifest.json   # theme preference and anything else in AsyncStorage
xcrun simctl ui booted appearance light|dark  # drive the system scheme without touching the UI
```

Timestamps are the useful trick: comparing a note's mtime against the bundle-load time is what distinguishes "an agent turn just succeeded on this code" from "that content was already on disk." Screenshots alone can't tell those apart, and a human poking the simulator while you work will otherwise read as a passing test.

Two things a simulator run **cannot** cover, so don't claim them: `userInterfaceStyle` (Expo Go supplies its own `Info.plist`, so appearance config only takes effect in a dev/production build) and anything gated on a native permission Expo Go already holds.

## The live test proves less than it looks like it does

`npm test` never calls a real model. `*.live.test.ts` files (run via `npm run test:live`, config in `jest.live.config.js`) hit the real OpenRouter API and are excluded from `npm test` on purpose — never fold them into the default suite or CI. They read credentials from `.env` (copy `.env.example`) via `dotenv/config`, loaded only in `jest.live.config.js` — never wire `.env` loading into the main suite or the app itself; the shipped app reads keys from the OS keychain, never env vars (PRD §8). The env var convention is `<PROVIDER>_API_KEY` / `<PROVIDER>_DEFAULT_MODEL`, matching a `Provider.id`, so it extends as more providers land (PRD §14.1).

## Git conventions

**Never mention Claude Code, Codex, Copilot, or any other AI coding tool/assistant in commit messages, PR titles, PR descriptions, or branch names.** No "Co-Authored-By" trailers for AI tools, no "Generated with ...” footers, no tool name anywhere in the history. This overrides any tool's default commit-message behavior — if a tool normally appends attribution, strip it before committing. Commits and PRs should read as if written by the person driving the session, with no indication that an AI assisted.

## Keeping this file current

When a milestone lands, or a new architectural rule gets established (a new invariant, a new required check before commit, a new directory convention), add it here. This file should never fall behind the actual state of the repo.
