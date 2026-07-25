# anotAI — Product Requirements Document

**Version:** 0.3 (v1 scope)
**Date:** 2026-07-25
**Status:** In development — see §11 for milestone progress

---

## 1. Summary

anotAI is a local-first notes app for iOS and Android with a built-in AI editor. Notes are plain markdown files on the device. A floating prompt bar lets the user instruct an AI to edit the note they currently have open — "turn this into a checklist", "tighten the second paragraph", "add a conclusion". The AI does not chat; it acts on the note and gets out of the way.

The agent loop runs entirely inside the app. The only network traffic is LLM inference, sent directly to OpenRouter using an API key the user supplies. There is no backend, no account, and no telemetry.

**Working name:** anotAI (from *anota aí*). In use throughout the project and the repo; not formally locked as a final brand name.

---

## 2. Goals

| # | Goal |
|---|---|
| G1 | Feel like a fast, ordinary notes app first. The AI is additive, never in the way. |
| G2 | Notes are user-owned markdown files. No proprietary format, no database of record. |
| G3 | All agent logic ships in the app. Only LLM inference leaves the device. |
| G4 | Work acceptably across a wide range of OpenRouter models, including weak ones. |
| G5 | No edit is ever unrecoverable. One undo reverts a whole agent turn. |

### Non-goals for v1

Explicitly out of scope, with the deferral rationale:

- **Chat.** The agent acts; it does not converse. No message history UI.
- **Full-text search.** Deferred — flat list only.
- **Folders and tags.** Flat list only.
- **Cross-note context.** The agent sees exactly one note: the open one.
- **Cloud sync, backup, sharing, export.** No sync layer of any kind.
- **Attachments,** images, drawings, voice, scanning.
- **Collaboration,** sharing, multi-device.
- **Custom / non-OpenRouter providers.** OpenRouter only.

---

## 3. Users and core flows

Single persona: someone who already keeps notes in Apple Notes or similar, is comfortable getting an OpenRouter key, and wants AI editing without pasting into a chatbot.

**Flow A — write and refine (primary)**
1. User opens app → flat list of notes → taps a note (or **+** for a new one).
2. Types normally in the editor.
3. Taps the prompt bar, types `make this a bulleted list`, submits.
4. Status line shows activity. Editor becomes briefly read-only.
5. Note updates. Changed regions are highlighted. Status line shows a one-line result.
6. User taps elsewhere or types → highlight clears. If unhappy, one undo reverts the entire turn.

**Flow B — first run**
1. User opens app, is told an OpenRouter key is required for AI features and that notes work fine without one.
2. Settings → paste key → pick a model.
3. Key is validated with one cheap request; result shown inline.

**Flow C — manual only.** Every note feature works with no key configured. The prompt bar is visibly disabled and explains why.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│  anotAI (Expo / React Native, TypeScript)           │
│                                                     │
│  ┌───────────────┐         ┌────────────────────┐   │
│  │  UI layer     │         │  Agent runtime     │   │
│  │  list/editor  │◀───────▶│  loop, tools,      │   │
│  │  prompt bar   │         │  context, compact  │   │
│  └───────┬───────┘         └─────────┬──────────┘   │
│          │                           │              │
│          ▼                           ▼              │
│  ┌──────────────────┐      ┌──────────────────┐     │
│  │ Note store       │      │ OpenRouter client│     │
│  │ (expo-file-      │      │ (streaming SSE)  │     │
│  │  system, .md)    │      └────────┬─────────┘     │
│  └──────────────────┘               │               │
│  ┌──────────────────┐               │               │
│  │ Secure store     │               │               │
│  │ (Keychain/       │               │               │
│  │  Keystore) — key │               │               │
│  └──────────────────┘               │               │
└─────────────────────────────────────┼───────────────┘
                                      │ HTTPS, only egress
                                      ▼
                              openrouter.ai/api/v1
```

The agent runtime is plain TypeScript with no React dependency, so it is unit-testable in Node without a simulator. Tools are injected as an interface, so tests use an in-memory note store.

---

## 5. Data model and storage

### On disk

```
<documentDirectory>/notes/
  01J8F2K9XQ.md
  01J8F3M1ZP.md
```

- One markdown file per note. Filename is a ULID + `.md`, generated at creation and never changed.
- **Files are the source of truth.** No database. Deleting the app's files deletes the notes; nothing else holds state.
- Note **title is derived**, never stored: first non-empty line, with leading `#` markers and whitespace stripped, truncated to 100 chars. Empty note → "New Note".
- Ordering uses the filesystem `modificationTime`. Most recently modified first.
- Deletion moves the file to `notes/.trash/` and it is purged after 30 days. Cheap insurance against a mistaken swipe.

### In memory

```ts
type Note = {
  id: string;           // ULID, == filename stem
  title: string;        // derived, cached
  body: string;         // full markdown
  modifiedAt: number;   // epoch ms, from filesystem
};
```

An optional in-memory index caches `{id, title, modifiedAt}` so the list view does not re-read every file on each render. It is a cache only — rebuilt from disk on cold start, never authoritative.

### Persistence policy

- Editor writes are debounced to disk at **500 ms** idle, and flushed on blur, navigation, and app backgrounding.
- Agent edits are written **immediately and synchronously** with the in-memory update, so a crash can never lose an agent turn.

---

## 6. Agent design

This is the core of the product. Everything here runs on-device except the HTTPS calls to OpenRouter.

### 6.1 Lifecycle

- Context is created when a note is opened and **destroyed when it is closed.** No cross-note and no cross-session memory. Reopening a note starts clean.
- Within one note session the user may issue many prompts; those accumulate in the context so follow-ups like "actually make it shorter" work.
- Backgrounding the app does **not** clear context. Closing the note does.

### 6.2 Message context

```ts
type AgentContext = {
  noteId: string;
  messages: Message[];      // excludes system prompt, rebuilt per request
  estimatedTokens: number;
};
```

The system prompt is regenerated on every request rather than stored, since it embeds live note state.

### 6.3 Note content injection

Hybrid, threshold-based:

- If the note is **below `INLINE_NOTE_TOKEN_LIMIT` (6,000 tokens)**, the full body is injected into the system prompt on every request. The model can act in a single round-trip with no `read_note` call.
- **At or above** the threshold, the system prompt includes only the note's size and first ~50 lines, and the model must call `read_note` with `offset`/`limit` to page through it.
- The system prompt always states which mode is active, so the model knows whether it already has the full text.

Token counts are estimated as `ceil(chars / 4)`. No tokenizer ships in v1 — thresholds are guardrails, not billing, and every one is generously padded.

### 6.4 Tools

Three tools. The model chooses between the two write tools.

**`read_note`** — re-read current content. Needed after an edit, after manual typing, or to page through a large note.

```ts
{
  name: "read_note",
  parameters: {
    offset?: number,  // 0-based line, default 0
    limit?: number,   // lines, default 500
  }
}
// → { content: string, total_lines: number, has_more: boolean }
```

Returns **raw text with no line-number prefixes.** This is deliberate: `patch_note` requires exact substring matches, and decorating output with line numbers is the single most reliable way to make a model produce strings that do not exist in the file.

**`rewrite_note`** — replace the entire body.

```ts
{
  name: "rewrite_note",
  parameters: { content: string }  // required, full new markdown body
}
// → { ok: true, bytes: number }
```

**`patch_note`** — targeted find/replace, batched.

```ts
{
  name: "patch_note",
  parameters: {
    edits: Array<{
      old_string: string,      // must match exactly, must be unique unless replace_all
      new_string: string,
      replace_all?: boolean,   // default false
    }>
  }
}
// → { ok: true, applied: number } | { ok: false, error: string, failed_index: number }
```

`patch_note` semantics — these rules exist because weak models fail at exact matching:

1. Edits apply **in order**, each against the result of the previous.
2. **Atomic.** Any failure discards the whole batch and returns an error. The note is never left half-edited.
3. Exact match is tried first. On miss, a **whitespace-normalized** match is tried (collapse runs of whitespace, ignore leading/trailing). Anything looser is rejected — fuzzy matching that guesses is worse than an error.
4. Non-unique `old_string` without `replace_all` is an error asking for more surrounding context.
5. Error messages are written **for the model**, and after a failed patch the error explicitly suggests `read_note` followed by `rewrite_note`.

### 6.5 Choosing between write tools

Guidance lives in the system prompt:

- `patch_note` for localized changes — fixing a sentence, editing a few list items, changing a heading.
- `rewrite_note` for structural changes — reordering sections, changing the whole format, or when more than roughly half the note changes.
- `rewrite_note` unconditionally when a `patch_note` batch has already failed once this turn.

Additionally, `rewrite_note` is **forced** (the `patch_note` schema is withheld from the request) when the note is under **500 tokens**. At that size a rewrite is cheap and patching only adds failure modes.

### 6.6 The loop

```
on submit(prompt):
  soft-lock editor (read-only)
  snapshot = current body
  push { role: "user", content: prompt }

  for i in 0 .. MAX_ITERATIONS(8):
    if estimatedTokens > COMPACT_THRESHOLD(50_000): compact()

    response = stream(openrouter, systemPrompt(note), messages, tools)

    if response.tool_calls:
      push assistant message with tool_calls
      for each call: execute locally, push tool result
      continue
    else:
      push assistant message
      break

  if loop exhausted: status = "Stopped after 8 steps."

  if body != snapshot:
    highlight diff(snapshot, body)
    push one undo entry containing the whole turn
  unlock editor
  status = final assistant text (or a default)
```

**Guards**

| Constant | Value | Purpose |
|---|---|---|
| `MAX_ITERATIONS` | 8 | Stops runaway tool loops. |
| `COMPACT_THRESHOLD` | 50,000 tok | Triggers compaction. |
| `INLINE_NOTE_TOKEN_LIMIT` | 6,000 tok | Inline vs. `read_note` mode. |
| `FORCE_REWRITE_BELOW` | 500 tok | Withhold `patch_note` for small notes. |
| `REQUEST_TIMEOUT` | 120 s | Per LLM request. |
| `MAX_NOTE_BYTES` | 2 MB | Refuse agent operation above this; editing still works. |

All are constants in one config module, not scattered literals.

### 6.7 Compaction

When `estimatedTokens` exceeds 50,000, before the next request:

1. Take all messages except the most recent user prompt.
2. Send **one separate, non-streaming** request asking for a summary of what the user has asked for and what has been changed so far — instructions and intent, not note content, since the note itself is always injected fresh.
3. Replace those messages with a single synthetic user message containing the summary, tagged as prior-session context.
4. If compaction fails, fall back to dropping the oldest messages until under threshold. **Compaction failure must never fail the user's turn.**

Compaction uses the main model by default. Settings expose an optional cheaper override, since summarization is undemanding.

### 6.8 Concurrency: manual edits during a turn

**v1: the editor is soft-locked** (read-only, visibly indicated, Cancel available) for the duration of an agent turn. Turns are typically a few seconds.

This is a deliberate simplification. It eliminates the entire class of write-conflict bugs — stale diffs, clobbered keystrokes, patches against text the model never saw. The v2 upgrade is a revision token: writes validate against the revision captured at turn start and return a "note changed, re-read it" error on mismatch, letting the user type freely throughout.

### 6.9 Streaming

- The final assistant **text** streams into the status line as it arrives.
- **Edits do not stream into the editor.** `rewrite_note` content arrives as streamed JSON tool-call arguments; rendering partially-parsed JSON into the editor produces visible garbage and broken markdown. Edits apply atomically once the tool call is complete.
- Cancel aborts the in-flight request. Already-applied tool calls stay applied — but since each turn is one undo entry, one undo still cleans up a cancelled turn completely.

### 6.10 System prompt sketch

Not final copy, but the required content:

- Role: you edit exactly one markdown note. You cannot see or reach any other note.
- Current note state: title, size, and either the full body or a preview plus `read_note` instructions.
- Tool selection guidance (§6.5).
- Output discipline: **make the edit, then reply with at most one short sentence.** No preamble, no restating the note, no offers of further help. The user reads a one-line status field, not a chat.
- Markdown conventions: preserve the user's existing style — heading depth, bullet characters, spacing.
- Refusal path: if the request is impossible or ambiguous, make no edit and say why in one sentence.

### 6.11 Provider interface

OpenRouter is the only provider in v1, but the agent loop **must not speak OpenRouter's wire format directly.** It speaks a canonical internal message format, and a thin adapter translates to and from the provider's API.

```ts
type CanonicalMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

interface Provider {
  readonly id: string;
  send(req: {
    system: string;
    messages: CanonicalMessage[];
    tools: ToolSchema[];
    signal: AbortSignal;
  }): AsyncIterable<
    | { type: "text"; delta: string }
    | { type: "toolCall"; call: ToolCall }
    | { type: "usage"; inputTokens: number; outputTokens: number }
    | { type: "error"; error: ProviderError }
  >;
}
```

The rationale is deferred-feature insurance and it is worth the hour it costs. Anthropic's Messages API uses `tool_use`/`tool_result` content blocks with `system` as a top-level parameter; Gemini uses `functionDeclarations` and `functionCall` parts. All three differ again in streaming event shape. With this interface, each new provider is an additive adapter file. Without it, adding one means rewriting the loop.

Secondary benefit, realized immediately: M2 tests run against a scripted mock provider with no network access.

---

## 7. UX

### 7.1 Note list
- Flat, reverse-chronological by modification time.
- Row: derived title, relative timestamp, one-line body preview.
- **+** creates a note and opens it with the cursor ready.
- Swipe to delete (to trash), with an undo snackbar.
- Empty state explains that notes are files on the device.
- Gear icon → Settings.

### 7.2 Editor

**Decision (post-spike):** M1 ships a plain `TextInput` + a rendered preview, toggled — not live rich rendering. Three candidates were spiked (throwaway code, since deleted):

| Candidate | Verdict |
|---|---|
| `@10play/tentap-editor` (WebView, TipTap/ProseMirror) | **Disqualified.** Its content model is HTML/ProseMirror-JSON — there is no `getMarkdown()`/`setMarkdown()` anywhere in its API, only `getHTML()`/`getJSON()`/`getText()`. Notes are markdown files and every agent tool operates on the literal markdown text, so this editor would require a bidirectional markdown⇄HTML conversion layer running on every load, save, and agent turn — a second document model, not a styling choice, and a source of drift against `patch_note`'s exact-match logic. Also failed to render on Expo web without additional undocumented setup, independent of the above.
| `@expensify/react-native-live-markdown` | Architecturally the best fit — it's a drop-in `TextInput` replacement where `value`/`onChangeText` *is* the raw markdown string, styled live via a parser, no conversion layer. Cost: native code, New-Architecture-only, and its README states Expo Go is unsupported — a dev client build is required to validate it on the actual target platform (mobile), which hasn't happened yet. Rendered fine on Expo web, which is a positive but not conclusive signal.
| `react-native-markdown-display` + toggle | **Chosen for M1.** Plain JS/RN-component rendering, no native module, works in Expo Go and on web today with zero extra setup. Same "value is the raw markdown string" property as live-markdown, minus the live inline formatting.

**Confirmed end goal:** live inline formatting (the `react-native-live-markdown` style) is still the target UX, deferred to a v1.1 polish pass once a dev-client build pipeline exists (needed for other native modules eventually anyway) and it's been validated on real iOS/Android, not just web. Swapping the editor component later is a contained change — nothing else in the app depends on which widget renders the text.

- Checkboxes are tappable — deferred past M1; needs a custom preview renderer override, not blocking the initial ship.
- Standard native selection, undo/redo, and keyboard handling.
- No title field. The first line *is* the title.

### 7.3 Prompt bar
- Floating, pinned above the keyboard, collapsed to a single line at rest, placeholder `Ask AI to edit this note…`.
- Grows to a few lines for longer prompts.
- Submit sends and clears the field.
- While a turn runs: spinner, Cancel, editor dimmed and read-only.
- With no API key: visibly disabled; tapping explains and links to Settings.

### 7.4 Status line
Thin, transient, directly under the prompt bar. Single line, truncated with tap-to-expand.

| State | Display |
|---|---|
| Working | `Thinking…` → `Reading note…` → `Editing…`, driven by actual tool calls |
| Success | The model's one-line reply, or `Done` if it said nothing |
| No change | `No changes made` plus the model's reason if given |
| Error | Human-readable message, tap for detail |
| Cancelled | `Cancelled` |

Clears on the next prompt, on manual typing, or after 30 s. Never accumulates history.

### 7.5 Change highlighting
- After a turn, changed regions get a subtle background tint. Insertions are tinted; deletions are **not** shown as strikethrough — this is a notes app, not a review tool.
- Word-level diff against the pre-turn snapshot (`fast-diff` or equivalent), computed once per turn regardless of which write tool ran.
- Clears on manual typing, on the next prompt, on note close, or after 60 s.
- Purely visual. Not persisted, and never written into the file.

### 7.6 Undo
- Shared stack with manual editing, but an **entire agent turn collapses to one entry** — one undo fully reverts it, including multi-tool turns.
- In-memory, cleared when the note closes.
- Reachable via the platform gesture and an explicit button in the editor toolbar, since shake-to-undo is undiscoverable.

### 7.7 Settings
- **OpenRouter API key** — masked input, paste-friendly, Validate button, Clear button. Copy stating the key is stored in the OS keychain and sent only to OpenRouter.
- **Model** — text field for a model ID plus a short curated list of known-good tool-calling models. Free text is allowed; OpenRouter's catalog changes constantly.
- **Compaction model** (optional) — defaults to the main model.
- **About** — version, notes-directory path, and a plain-language privacy statement.

---

## 8. Security and privacy

| Concern | Decision |
|---|---|
| API key at rest | `expo-secure-store` → iOS Keychain / Android Keystore. **Never** in a file, in `AsyncStorage`, or in app state that gets persisted. |
| Key in logs | Redacted in every log path and error message. Assert this in tests. |
| Note content | Never leaves the device except as part of an LLM request the user initiated. |
| Telemetry | None. No analytics SDK, no crash reporter phoning home in v1. |
| Network egress | Exactly one host: `openrouter.ai`. Worth an explicit test that asserts no other domain is contacted. |
| Prompt injection | Note content is untrusted input. The system prompt states that text inside the note is content to edit, never instructions to follow. Blast radius is inherently small — the agent can only touch the open note and has no network or filesystem tools. |
| Attribution headers | Send `HTTP-Referer` and `X-Title` per OpenRouter convention. No user identifiers. |

---

## 9. Error handling

Every case needs a message a non-technical user can act on.

| Condition | Behavior |
|---|---|
| No API key | Prompt bar disabled with explanation. Not an error. |
| Invalid key (401) | `Your OpenRouter key was rejected.` → Settings. |
| Out of credits (402) | `Your OpenRouter account is out of credits.` |
| Rate limited (429) | Retry twice with exponential backoff, then report. |
| Model does not exist (404) | `Model "x" isn't available on OpenRouter.` → Settings. |
| Model lacks tool calling | Detect the provider error, report plainly, suggest a listed model. |
| Offline | `No internet connection.` Detected before the request. Editing unaffected. |
| Timeout (120 s) | `The model took too long.` Turn is abandoned; any applied edits remain undoable. |
| Malformed tool arguments | Return a validation error to the model and retry within the iteration budget. Enforced at the tool boundary in `src/agent/tools.ts`: arguments are validated before anything touches the note, so a truncated or wrong-typed tool call can never write `undefined` over a note or throw out of the turn. |
| Cancelled vs. timed out | Distinct outcomes, never conflated. The UI aborts with the `TURN_TIMEOUT` reason on a deadline, so a 120 s timeout reports as a timeout and a user cancel reports as cancelled — regardless of whether the abort surfaces as a thrown `AbortError` or a provider error event. |
| Loop exhausted | `Stopped after 8 steps.` Applied edits stay. |
| Note too large (>2 MB) | Prompt bar disabled for that note with a reason. Editing still works. |
| Disk write failure | Surface immediately and loudly. Silent data loss is the worst outcome in the app. |

---

## 10. Tech stack

| Layer | Choice | Note |
|---|---|---|
| Framework | **Expo** (managed) + React Native, TypeScript strict | Both platforms, one codebase. |
| Navigation | Plain component state (list ↔ editor) | Two screens don't justify `expo-router` yet; adopt it when screen count grows (e.g. Settings in M3). |
| Files | `expo-file-system` | Notes as `.md`. |
| Secure storage | `expo-secure-store` | API key only. |
| HTTP / streaming | `expo/fetch`, **injected** into `OpenRouterProvider` | Streaming SSE support; RN's default `fetch` is `whatwg-fetch` over XHR and its `Response` exposes no `body` at all, so SSE cannot be read from it. Expo SDK 57 *does* replace `globalThis.fetch` with its streaming implementation, but that is an implicit side effect gated on `EXPO_PUBLIC_USE_RN_FETCH` — so the app passes `expo/fetch` explicitly rather than depending on a global patch the framework-free agent core can't see. **Validate on a physical device early.** |
| Markdown editor | `TextInput` + `react-native-markdown-display`, toggled | Decided post-spike — see §7.2. Live inline formatting deferred to v1.1. Requires the `punycode` npm package as a real dependency (not unused) — `markdown-it`, its transitive dependency, imports Node's `punycode` core module, absent from the RN runtime. |
| Diff | `fast-diff` or `diff-match-patch` | Word-level, for highlighting. |
| IDs | `ulid` | Sortable, collision-free. Requires `react-native-get-random-values` imported first in `src/app/index.ts` — Hermes has no native `crypto.getRandomValues`. |
| State | Zustand or Context | Small surface; no Redux. |
| Testing | Jest for the agent runtime | Runtime is React-free, so tests need no simulator. |

**Deliberately absent:** no backend, no database, no auth provider, no sync engine, no analytics.

---

## 11. Milestones

**M2 — Agent runtime, headless. ✅ Done.** Loop, three tools, system prompt, provider interface with an OpenRouter adapter, compaction. Built against an in-memory store and unit-tested with **no UI at all** — 25 Jest tests, no simulator, no network. Lives in [`src/agent/`](./src/agent). Built before M1 deliberately: the agent loop is where the risk lives, and it is far cheaper to iterate on in Jest than through a simulator. The `OpenRouterProvider` has since been validated against the live API (§12 risk: simulator only so far, not physical hardware).

**M1 — Notes app, no AI. ✅ Done.** List, editor, file storage, trash, undo. Lives in [`src/notes/`](./src/notes) and [`src/screens/`](./src/screens). Manually confirmed on an iOS simulator: create, edit, delete, swipe-to-delete-with-undo, and manual undo/redo all work. Editor is a plain `TextInput` + toggled preview, not live rich rendering — see §7.2 for the post-spike decision.

**M3 — Wire it up. ✅ Done.** `runTurn()` connected to a real editor: a Settings screen (API key + model, OS keychain via `expo-secure-store`, clipboard paste, live validation against OpenRouter), a FAB-driven prompt composer (soft-lock while a turn runs, turn-level undo via the same snapshot stack as manual edits, provider errors mapped to human messages per §9). **Confirmed working end-to-end against the live API** — an AI-edited note exists on the test simulator, created via a real prompt. Also absorbed a full design pass beyond the original M3 scope: light/dark/system theming with an orange accent (`src/theme/`, persisted via AsyncStorage), vector icons (`@expo/vector-icons`) replacing text/emoji glyphs throughout, and the FAB composer's current interaction (Redo/Undo stacked above the main FAB; the FAB itself morphs into the send button — arrow when there's text, close when empty — when the composer is open).

**M4 — Change highlighting.** Diff and tint. Last because it is pure polish and touches the editor's internals. Not started.

**M5 — Harden.** Full error matrix, model-compatibility passes across a spread of OpenRouter models, physical-device testing, large-note behavior, store assets and review prep. Not started. Note physical-device validation is now the main open item here — simulator behavior is confirmed, real hardware (especially RN's historically fragile fetch-streaming) is not.

---

## 12. Open questions and risks

**Needs a decision**

1. ~~**Markdown editor**~~ **Decided** — see §7.2. Preview-toggle for M1; live inline formatting deferred to v1.1 pending dev-client validation.
2. **Curated model list** — which models to recommend, and how to keep it from going stale without a backend.
3. **Onboarding** — does the app explain the OpenRouter key requirement up front, or stay silent until AI is first used?

**Risks**

- **Model quality variance** is the top product risk. A user on a weak free model will experience the app as broken. Mitigations: force `rewrite_note` on small notes, a curated model list, clear error messages. Consider a first-run compatibility check.
- **Cost surprise.** Whole-note rewrites on long notes burn output tokens. Consider surfacing per-turn token usage from the OpenRouter response.
- **Streaming on RN** has historically been fragile. Confirmed working on an iOS **simulator** (§11 M3), and re-confirmed after `expo/fetch` was made an explicit injected dependency rather than an incidental global (§10) — a real `rewrite_note` turn completed end-to-end on that code path. Physical iOS and Android hardware still untested, and simulators don't always reproduce real-device fetch/streaming issues. Do this before M5, not during it.
- **The live smoke test cannot catch RN-specific transport bugs.** `npm run test:live` runs under Node, where `globalThis.fetch` is undici and streams fine — a different code path from the app's. It validates the OpenRouter *wire format*, not React Native's transport. Only a device or simulator run covers that, which is why the deterministic adapter tests (`src/agent/providers/openrouter.test.ts`) cover the fragmented/terminator/finish_reason cases instead of trusting the live test.
- **App Store review.** BYO-key AI apps are permitted, but reviewers sometimes ask about unmoderated content. Expect one round of questions.
- **RN runtime gaps surface late, not at build time.** Getting M1 running on an iOS simulator surfaced three separate issues that a clean `tsc`/web-bundle check did not catch: `ulid` needs a `crypto.getRandomValues` polyfill Hermes doesn't provide (`react-native-get-random-values`), `react-native-markdown-display`'s `markdown-it` dependency imports Node's `punycode` core module which doesn't exist in the RN runtime (fixed by installing the userland `punycode` package), and `expo-file-system`'s new `Directory`/`File` classes don't work on web at all despite compiling cleanly. Full details and fixes: `AGENTS.md` → "Environment gotchas." Lesson for future milestones: a compiling web bundle proves far less than an actual simulator run — budget for this class of surprise in M3/M4 too, not just M1.

**Explicitly deferred to v2+**

Search · folders and tags · cross-note context · sync and export · revision-token concurrency (§6.8) · chat · attachments · a real tokenizer.

Multi-provider support, voice input, and managed credits are planned and scoped in **§14 — Roadmap**. Only one of them imposes a v1 requirement: the provider interface in §6.11.

---

## 13. Success criteria

v1 is done when:

1. The app is a genuinely good notes app with no API key configured.
2. A mid-tier OpenRouter model reliably completes common edit requests on a typical note in one turn.
3. One undo always fully reverts an agent turn.
4. No error state leaves the user without an actionable message.
5. No network request goes anywhere except `openrouter.ai`.
6. The agent runtime's test suite runs in Node with no simulator and no network.

---

## 14. Roadmap beyond v1

Three planned features, ordered by cost-to-value. Only §14.1 imposes any v1 obligation, and it is already absorbed by the provider interface in §6.11.

### 14.1 Multi-provider support — v2.0

Direct support for OpenAI, Anthropic, and Google alongside OpenRouter.

**Work:** one adapter per provider implementing `Provider` (§6.11), a provider picker in Settings, a key per provider in secure storage, and a per-provider curated model list. The agent loop, tools, compaction, and UI are untouched.

**Why the v1 interface matters:** the three APIs differ in message shape, in how the system prompt is passed, in tool-call representation, and in streaming events. With the adapter boundary this is additive; without it, it is a rewrite of the core loop.

**Open points**
- Model capability discovery. OpenRouter exposes `/models`; direct providers each differ. Tool-calling support is not uniformly advertised and may need a curated allowlist per provider.
- Verify each provider's terms permit direct client-side calls with a user's own key, and check for any client-origin header requirements.
- Keep OpenRouter the default. It is one key for many models, which is the lower-friction path for most users.

**Risk:** low. Additive and independently testable against the mock provider.

### 14.2 Voice input — v2.1

Mic button next to the prompt bar. Speech becomes prompt text.

**Hard constraint:** OpenRouter has no transcription endpoint — it routes chat completions. Voice cannot be served by the v1 provider at all.

**Options**

| Approach | Cost | Privacy | Notes |
|---|---|---|---|
| **On-device STT** (recommended) | Free | Best available | iOS `SFSpeechRecognizer`, Android `SpeechRecognizer`. Accuracy is adequate for short command phrases. |
| Cloud STT (Whisper, Deepgram) | Per minute | Audio leaves device | Better accuracy and punctuation. Needs a second key or a credits balance. |

**Recommendation:** on-device only, with cloud STT reconsidered if accuracy proves inadequate in practice.

**Privacy caveat that must be disclosed accurately:** iOS `SFSpeechRecognizer` sends audio to Apple by default. Staying local requires `requiresOnDeviceRecognition`, which is not available on every device or locale. So the honest claim is "on-device where supported, with a disclosed fallback" — not unconditionally local. Wording in Settings and the privacy statement must reflect this.

**Interaction — needs a decision.** Two readings of "the agent should act only after the user clicks the button":

- **(a) Transcribe, then submit separately.** Mic fills the prompt bar; user reads it and submits. **Recommended** — a misheard word otherwise silently mangles a note, and transcription errors are common with proper nouns and technical terms.
- **(b) Stop recording fires the turn.** One less tap, faster, but no chance to catch a mistranscription before it edits the file.

**Work:** `expo-av` or `@react-native-voice/voice` plus a config plugin. This leaves Expo Go — a dev client build is required. Mic and speech-recognition usage descriptions needed for iOS review.

**Risk:** medium. Permissions handling, interrupted-recording states, and the dev-client requirement.

### 14.3 Access for non-developers

The goal is users who do not know what an API key is. There are two very different ways to get there, and they should not be conflated.

#### Step 1 — OpenRouter OAuth connect (v2.2, cheap)

OpenRouter supports an OAuth PKCE flow. The user taps "Connect OpenRouter," authorizes in a browser, and the app receives a key programmatically. **The user never sees or handles an API key.**

- No backend. No IAP. You never touch money or notes.
- Users still need an OpenRouter account with credit, so this removes the *key-handling* friction but not the *signup and payment* friction.
- **Action: validate the current OAuth flow against OpenRouter's docs before scoping.** If it works as expected, this is the highest-value-per-effort item on the entire roadmap.

#### Step 2 — Managed credits (separate track, not a normal feature)

In-app credit purchase via Apple/Google Pay, inference served through a house key on a hidden cheap model.

**This cannot be built as an app feature, because the house key cannot live in the app.** A shipped key gets extracted by decompilation or by proxying traffic on a rooted device, and then drained. There is no client-side mitigation. The feature therefore requires a **server-side proxy**, and that changes what the project *is*.

**What it costs you architecturally** — every v1 property in this document that is a selling point:

| v1 property | After managed credits |
|---|---|
| No backend | Proxy service: deploy, monitor, scale, keep up |
| No account | Credit balances need durable identity |
| No telemetry, nothing of yours touched | Notes transit your infrastructure |
| One egress host | Two paths with different trust properties |

**Consequences to plan for**

- **Store tax and payment rails.** Digital credits must use IAP; Stripe is not permitted for this on iOS. Apple/Google take 15–30% (15% under the small-business programs). A $4.99 pack nets roughly $3.50–4.25 before infra.
- **Unit economics are fine; fixed costs are the problem.** At current cheap-tier tool-calling prices, a typical turn on a short note costs order-of-magnitude a tenth of a cent, so a few dollars buys thousands of turns with comfortable margin. *(Verify against live pricing — model rates move constantly.)* The real expense is the standing cost of running a service: uptime, abuse, support, refunds, and tax handling.
- **Identity.** Consumable IAP does not restore across reinstall or a new device, so an anonymous balance simply disappears. Realistically this means Sign in with Apple — which contradicts "no account." Decide deliberately rather than discovering it late.
- **Abuse controls.** Server-side receipt validation against Apple and Google, replay protection, per-account rate limits, and a hard spend ceiling per balance.
- **Trust posture.** Publish that BYO-key and OAuth modes send nothing to your infrastructure while credits mode proxies note content, and that the proxy does not log request or response bodies. This is the main cost of the feature and it is reputational, not technical.
- **Review.** Apple guideline 3.1.1 mandates IAP here, and AI content generation attracts moderation questions. A hidden model choice is not itself a problem.

**Recommendation:** treat this as a business decision — payments, taxes, liability, support load — evaluated after v2 ships and only if OAuth connect proves insufficient. Do **not** let it slip into a feature backlog.

**The cheap hedge, available today:** because of §6.11, a future house proxy is just another `Provider` implementation pointing at your endpoint. The agent runtime needs no changes whenever you decide. Keeping that door open costs nothing now.

### 14.4 Sequencing

```
v1     Notes + agent, OpenRouter BYO key
v2.0   Multi-provider adapters          ← additive, low risk
v2.1   Voice input, on-device STT       ← needs dev client
v2.2   OpenRouter OAuth connect         ← best value/effort; validate flow first
─────  business decision gate ─────
v3?    Managed credits + proxy          ← only if OAuth proves insufficient
```

Deferred from §12 (search, folders, cross-note context, sync) is orthogonal to all of the above and slots in wherever user demand points.
