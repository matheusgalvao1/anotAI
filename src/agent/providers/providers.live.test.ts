import { runTurn } from "../loop";
import { InMemoryNoteStore } from "../noteStore";
import { Provider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { OpenAiProvider } from "./openai";
import { OpenRouterProvider } from "./openrouter";

/**
 * Live smoke tests against every real provider API. **Not run by `npm test`** —
 * see jest.live.config.js / `npm run test:live`. These cost real money.
 *
 * Reads from .env (see .env.example), one pair per provider:
 *
 *   <PROVIDER>_API_KEY / <PROVIDER>_DEFAULT_MODEL
 *
 * Each provider is skipped independently when its pair is unset, so a .env with
 * only one key configured still runs cleanly rather than failing three suites.
 *
 * Why this matters more than the deterministic tests: those pin the wire formats
 * as *documented*. Only this proves the documentation matches the API — and the
 * OpenRouter adapter's real bugs were all in streaming and tool-call assembly,
 * which is exactly what a note edit exercises end to end.
 *
 * No `fetch` is injected here: Node's global fetch streams properly. The app
 * must still pass `expo/fetch` (see AGENTS.md), which is a runtime concern this
 * test deliberately doesn't cover.
 */

type LiveProvider = {
  label: string;
  envPrefix: string;
  build: (apiKey: string, model: string) => Provider;
};

const LIVE_PROVIDERS: LiveProvider[] = [
  {
    label: "OpenRouter",
    envPrefix: "OPENROUTER",
    build: (apiKey, model) => new OpenRouterProvider({ apiKey, model, title: "anotAI live smoke test" }),
  },
  { label: "OpenAI", envPrefix: "OPENAI", build: (apiKey, model) => new OpenAiProvider({ apiKey, model }) },
  { label: "Anthropic", envPrefix: "ANTHROPIC", build: (apiKey, model) => new AnthropicProvider({ apiKey, model }) },
  { label: "Google Gemini", envPrefix: "GOOGLE", build: (apiKey, model) => new GoogleProvider({ apiKey, model }) },
];

jest.setTimeout(90_000);

for (const provider of LIVE_PROVIDERS) {
  const apiKey = process.env[`${provider.envPrefix}_API_KEY`];
  const model = process.env[`${provider.envPrefix}_DEFAULT_MODEL`];
  const canRun = Boolean(apiKey && model);

  if (!canRun) {
    // eslint-disable-next-line no-console
    console.log(
      `\nSkipping ${provider.label} live smoke test — set ${provider.envPrefix}_API_KEY and ` +
        `${provider.envPrefix}_DEFAULT_MODEL in .env to run it (see .env.example).\n`,
    );
  }

  const maybeDescribe = canRun ? describe : describe.skip;

  maybeDescribe(`${provider.label} (live)`, () => {
    it("completes a note edit end-to-end, including a tool call", async () => {
      const store = new InMemoryNoteStore("Shopping list:\n- eggs\n- bread");

      const result = await runTurn({
        prompt: "Add 'milk' as another list item. Don't change anything else.",
        noteTitle: "Shopping list",
        store,
        history: [],
        provider: provider.build(apiKey!, model!),
      });

      // eslint-disable-next-line no-console
      console.log(
        `--- ${provider.label} (${model}) ---\n` +
          `body:\n${result.newBody}\n` +
          `status: ${result.finalText}\n` +
          `stoppedReason: ${result.stoppedReason}, toolCalls: ${result.toolCallsExecuted}`,
      );

      expect(result.stoppedReason).toBe("completed");
      // A tool call is the point: text-only replies mean the model never edited.
      expect(result.toolCallsExecuted).toBeGreaterThan(0);
      expect(result.newBody.toLowerCase()).toContain("milk");
      expect(result.newBody.toLowerCase()).toContain("eggs");
      expect(result.finalText.length).toBeGreaterThan(0);
    });
  });
}
