# anotAI

A local-first notes app for iOS and Android with a built-in AI editor. Notes are plain markdown files on the device. A floating prompt bar lets you ask an AI to edit the note you have open — the AI acts on the note directly; it doesn't chat.

The agent — the loop that talks to the model and executes its tool calls — runs entirely inside the app. The only network traffic is LLM inference, sent directly to whichever provider you configure — [OpenRouter](https://openrouter.ai), OpenAI, Anthropic, or Google Gemini — using an API key you supply. There is no backend, no account, and no telemetry.

- **[PRD.md](./PRD.md)** — product spec, architecture, milestones, open decisions
- **[AGENTS.md](./AGENTS.md)** — conventions, invariants and environment gotchas for anyone changing the code

## Stack

- **Expo** (React Native) + TypeScript, strict mode
- **Jest** + `ts-jest` for the agent core — headless, no `jest-expo` or simulator required
- **Four LLM providers** — OpenRouter, OpenAI, Anthropic, Google Gemini — behind one `Provider` interface, so adding another is additive rather than a rewrite (PRD §14.1)

The editor is a plain `TextInput` with a toggled markdown preview rather than live inline formatting. Three approaches were compared before settling on it — see PRD §7.2.

## Project layout

```
src/agent/               agent core — plain TypeScript, no React/RN imports
  index.ts               the core's public surface
  types.ts               canonical message format + Provider interface
  config.ts              tunable constants (iteration cap, thresholds, timeout)
  tools.ts               read_note / rewrite_note / patch_note
  systemPrompt.ts        per-turn system prompt (inline vs. read_note mode)
  tokens.ts              chars/4 estimate, a guardrail for the thresholds below
  compaction.ts          context summarization once a session exceeds 50k tokens
  loop.ts                runTurn() — the agent loop
  noteStore.ts           NoteStore interface + in-memory implementation for tests
  providers/
    transport.ts         shared SSE reading, fetch injection, HTTP error classification
    openaiCompatible.ts  the OpenAI-shaped wire format, shared by the two below
    openrouter.ts        OpenRouter
    openai.ts            OpenAI
    anthropic.ts         Anthropic
    google.ts            Google Gemini
    mock.ts              scripted Provider for deterministic tests

src/notes/               note storage + pure helpers, no AI
  noteRepository.ts      file-backed CRUD; wraps every FS call as NoteStoreError
  agentNoteStore.ts      adapts noteRepository to the agent's single-note NoteStore
  title.ts               derives title + preview from body (never stored)
  undoStack.ts           snapshot undo/redo, pushed at debounced save boundaries
  trashName.ts           encodes deletion time in trashed filenames
  changedRange.ts        where two versions of a note differ, for change highlighting
  relativeTime.ts        list-row timestamp formatting

src/settings/            provider credentials + model selection
  providers.ts           the four providers and how each carries its key
  secureSettings.ts      API keys + selected model, OS keychain (expo-secure-store)
  buildProvider.ts       picks the adapter for a provider id
  modelCatalogue.ts      fetches and caches each provider's model list
  modelList.ts           turns a raw catalogue into the list the picker shows
  modelSelection.ts      reads a stored selection, tolerating anything unexpected
  validateApiKey.ts      one cheap request to confirm a key/model pair works

src/theme/               light/dark/system theming, orange accent
  palette.ts             light/dark color tokens
  ThemeContext.tsx       provider + useTheme(), persists preference via AsyncStorage
  icons.tsx              every icon, named for meaning rather than glyph

src/screens/             app UI
  NoteListScreen.tsx     flat list, swipe-to-delete + undo snackbar, create FAB
  NoteEditorScreen.tsx   presentation only — composes the two hooks below
  useNoteSession.ts      one note's body: debounced saves, lifecycle flush, undo/redo
  useAgentTurn.ts        one agent turn: credentials, provider, history, cancel, errors
  AgentFab.tsx           floating Undo/Redo/Ask-AI cluster; FAB becomes send when open
  NoteHighlight.tsx      renders the last turn's changed range in the editor
  SettingsScreen.tsx     API keys, model, Appearance (Light/Dark/System), About
  Dropdown.tsx           the inline provider/model pickers in Settings
  useKeyboardHeight.ts   how much of the screen the keyboard covers, in points

src/app/                 Expo entry shell — plain component-state navigation (no router)
  App.tsx                root component, screen switch, ThemeProvider
  index.ts               registerRootComponent; crypto polyfill must stay first import
  assets/                app icons
```

`app.json` and `package.json` stay at the repo root and point into `src/app/` — Expo CLI and npm only look for them there.

## Getting started

```bash
npm install
npm test          # agent core + notes logic — fast, no simulator, no network
```

Other scripts: `npm run test:watch`, `npx tsc --noEmit`, `npx expo-doctor`.

## Running the app

Two ways to run anotAI, and they are not interchangeable.

| | iOS Simulator | Physical iPhone |
|---|---|---|
| Command | `npm run ios` | `npx expo run:ios --device` |
| What actually runs | Expo Go | a development build you compile yourself |
| Apple account | none | any Apple ID, free is fine |
| First run takes | a minute or two | 5–15 min native compile |
| Verifies native config (`userInterfaceStyle`, permissions) | no | yes |

After the first run, both reload JS from Metro without rebuilding. **Start with the simulator** — it covers almost all day-to-day work.

### iOS Simulator

**Prerequisite:** Xcode, with iOS platform support installed (Xcode → Settings → Components). No Apple developer account needed.

```bash
npm run ios
```

That starts Metro, boots a simulator, and opens the app inside Expo Go — downloading Expo Go into the simulator on first run. There's no build step and nothing to open in Xcode.

You're up when the terminal prints:

```
iOS Bundled 6693ms src/app/index.ts (1047 modules)
```

That line is worth waiting for rather than skimming past: it proves every native module resolved in the React Native runtime, which a clean `tsc` does not cover.

While it runs: `r` reloads the app, `i` reopens the simulator, `Ctrl-C` stops the server.

`npm run android` works the same way. **`npm run web` bundles but notes don't work** — `expo-file-system`'s `File`/`Directory` classes throw on web. Web is a dev convenience, not a target platform (PRD §1).

**What the simulator cannot show you:** `userInterfaceStyle` in `app.json` has no effect under Expo Go, which supplies its own `Info.plist`, so the Light/Dark/System picker can't be fully verified here. Neither can real performance or the real keyboard.

### Physical iPhone, over USB

**Expo Go is not an option on a physical device for this project.** Expo Go has to match the project's SDK, and the App Store build lags: per [Expo's May 2026 changelog](https://expo.dev/changelog/expo-go-and-app-store-may-2026) it was still on SDK 54 while this project is on SDK 57. Building a newer Expo Go yourself needs a paid Apple Developer membership and your own TestFlight; a development build needs only a free Apple ID.

**One-time setup**

1. Xcode, plus Command Line Tools selected in Xcode → Settings → Locations.
2. An Apple ID added in Xcode → Settings → Accounts. A free one works; the installed app just stops opening after 7 days and needs reinstalling.
3. **Developer Mode on the phone:** Settings → Privacy & Security → Developer Mode → on. The phone restarts and asks you to confirm.
4. Plug the phone in, unlock it, and tap **Trust** when it asks about the computer.
5. If you're not the original author, set `ios.bundleIdentifier` in `app.json` to something unique to you — two people can't install the same bundle id signed by different teams.

**Build and install**

```bash
npx expo run:ios --device
```

This prompts you to choose from the connected devices, compiles natively, installs over the cable, and starts Metro. Pass the name to skip the prompt: `npx expo run:ios --device "<your iPhone's name>"`.

**Unlock the phone and keep it awake.** If it's locked, the run fails at the very last step with `Cannot launch anotAI on <device> because the device is locked` — after a full successful compile. The build is cached, so retrying is quick.

On first launch iOS may refuse to open an app signed with a personal certificate. Settings → General → VPN & Device Management → trust your developer certificate. Once only.

After the first install, JS changes need no rebuild — `npm start`, then tap the app icon. Rebuild natively only after changing `app.json`, native config, or adding a native module.

**The cable only installs the binary; Metro still serves your JavaScript over the network.** iOS has no `adb reverse` equivalent, so the phone and the computer must be on the same Wi-Fi. If the app launches but hangs on a blank or red screen, that's this. Where the network blocks it — corporate Wi-Fi with client isolation is the usual culprit — use `npx expo start --tunnel` instead.

### First run: enabling AI editing

Applies to both ways of running. The notes app works immediately, but AI editing is off until you supply a key — there's no backend and no bundled credentials.

1. Tap the **gear** on the note list → Settings
2. Under **API keys**, paste a key next to whichever provider you want to use. Each row has a paste button and an eye toggle. There is no Save button; every edit is written to the keychain as you make it.
3. Tap the **check** on that row to validate — one cheap real request confirming the key works.
4. Under **Model**, choose that provider, then pick a model from the list or type an id.

**Every provider spells model ids differently**, and each convention has caused a failed run here: OpenRouter usually wants a provider prefix (`openai/gpt-4o-mini`), OpenAI never does, Anthropic dashes version numbers and never dots them (`claude-haiku-4.5` 404s; `claude-haiku-4-5-20251001` works), and Gemini ids drop the `models/` prefix its catalogue returns. Pick from the list rather than typing where you can. Validating is worth the tap either way: the check sends a real tool call, not just a hello, so a model that can't edit notes fails there rather than on your first edit.

Keys go to the OS keychain via `expo-secure-store`, never to a file in the repo.

**If paste does nothing in the simulator**, the clipboard genuinely is empty — the simulator has its own pasteboard. Bridge it explicitly:

```bash
pbpaste | xcrun simctl pbcopy booted
```

Then open a note, tap the **✦ FAB**, and type something like "turn this into a numbered list".

### Troubleshooting

**"Build Succeeded" is not the last word.** `expo run:ios` prints it after compiling and still has to install and launch, either of which can fail on its own. Read the final line of the output.

**Don't move the repo after a native build.** CocoaPods bakes absolute paths into ~200 generated files under `ios/`, so relocating the checkout fails the build with an error naming a directory that no longer exists (`React-VFS.yaml ... not found`). Recover with:

```bash
rm -rf ios/build node_modules/expo-modules-jsi/apple/.DerivedData
pod install --project-directory=ios
grep HERMES_CLI_PATH "ios/Pods/Target Support Files/Pods-anotAI/"*.xcconfig
```

`pod install` fixes every path except `HERMES_CLI_PATH`, which it can restore from a stale cache — hence the last line; correct it by hand if it still points at the old location. `ios/` is gitignored and entirely generated, so deleting it and rebuilding is always safe. Check `package.json`'s `ios`/`android` scripts afterwards if you do, since `expo prebuild` rewrites them into full native compiles.

**Metro dying with `EMFILE: too many open files`** is almost always watchman, not your file-descriptor limit. Keep the repo out of `~/Downloads`, `~/Desktop`, `~/Documents` and iCloud Drive, which macOS gates behind Full Disk Access. If `watchman watch-project /private/tmp` also fails, reboot — the broken state is in the kernel and restarting the daemon won't clear it. AGENTS.md has the full diagnosis and the list of workarounds that don't work.

## Environment variables

```bash
cp .env.example .env
```

`.env` is gitignored and read only by `npm run test:live`. The shipped app never reads keys from env vars — a user's key lives in the OS keychain, set in Settings (PRD §8). The convention is `<PROVIDER>_API_KEY` / `<PROVIDER>_DEFAULT_MODEL`, one pair per provider; `.env.example` documents each provider's model-id quirks at the variable that needs it.

## Testing

```bash
npm test           # agent core + notes logic — no simulator, no network
npm run test:live  # one real turn per configured provider — spends money
```

`npm test` never talks to a real model. The agent core has zero dependency on React or React Native specifically so it can be tested in Node, and `src/agent/providers/mock.ts` is a scripted `Provider` that makes loop behaviour deterministic — tool-call chaining, the forced-rewrite threshold, the iteration cap, cancellation, compaction fallback. Each of the four adapters also has unit tests for the wire-format cases a happy path never reaches: events split across chunk boundaries, CRLF separators, streams ending without a terminator, truncated tool-call JSON, HTTP status mapping. `fetch` is injected rather than stubbed globally.

`npm run test:live` hits the real APIs. It runs one turn per provider and asserts a tool call actually ran, since a text-only reply means the model never edited anything. Each provider is skipped independently when its key pair is missing from `.env`, so filling in one of the four is fine. It's excluded from `npm test` and from CI so it never runs by accident.

**It proves less than it looks like it does:** it runs under Node, where `globalThis.fetch` is undici, so it exercises a different transport than the app and says nothing about how the app behaves — only that the wire formats are right. All four providers pass it; OpenRouter has additionally been exercised through the app itself. AGENTS.md records what the first live run turned up, which is the argument for keeping it: three adapters passed every deterministic test and still failed on first contact.

## License

MIT — see [LICENSE](./LICENSE).
