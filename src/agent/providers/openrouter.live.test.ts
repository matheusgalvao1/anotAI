import { InMemoryNoteStore } from "../noteStore";
import { runTurn } from "../loop";
import { OpenRouterProvider } from "./openrouter";

/**
 * Live smoke test against the real OpenRouter API. Not run by `npm test` —
 * see jest.live.config.js / `npm run test:live`. Reads from .env (see
 * .env.example):
 *
 *   OPENROUTER_API_KEY          your key, from https://openrouter.ai/keys
 *   OPENROUTER_DEFAULT_MODEL    a model slug, e.g. "openai/gpt-4o-mini"
 *
 * This exists because OpenRouterProvider's streaming + tool-call parsing has
 * only ever been exercised against the mock provider in the regular suite —
 * this is the first time it talks to a real model (PRD §12 risk: "streaming
 * on RN" / provider validation).
 */
const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_DEFAULT_MODEL;
const canRun = Boolean(apiKey && model);

const maybeDescribe = canRun ? describe : describe.skip;

if (!canRun) {
  // eslint-disable-next-line no-console
  console.log(
    "\nSkipping OpenRouter live smoke test — set OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL in .env to run it " +
      "(see .env.example), then: npm run test:live\n",
  );
}

jest.setTimeout(60_000);

maybeDescribe("OpenRouterProvider (live)", () => {
  it("completes a simple note edit end-to-end", async () => {
    const store = new InMemoryNoteStore("Shopping list:\n- eggs\n- bread");
    const provider = new OpenRouterProvider({
      apiKey: apiKey!,
      model: model!,
      title: "anotAI live smoke test",
    });

    const result = await runTurn({
      prompt: "Add 'milk' as another list item. Don't change anything else.",
      noteTitle: "Shopping list",
      store,
      history: [],
      provider,
    });

    // eslint-disable-next-line no-console
    console.log("--- final note body ---\n" + result.newBody);
    // eslint-disable-next-line no-console
    console.log("--- status line ---\n" + result.finalText);
    // eslint-disable-next-line no-console
    console.log(`--- stoppedReason: ${result.stoppedReason}, toolCalls: ${result.toolCallsExecuted} ---`);

    expect(result.stoppedReason).not.toBe("cancelled");
    expect(result.newBody.toLowerCase()).toContain("milk");
    expect(result.finalText.length).toBeGreaterThan(0);
  });
});
