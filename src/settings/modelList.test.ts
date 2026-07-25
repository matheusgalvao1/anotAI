import {
  CatalogueModel,
  parseAnthropicModels,
  parseGoogleModels,
  parseModels,
  parseOpenAiModels,
  parseOpenRouterModels,
  sortModels,
} from "./modelList";

function model(id: string, name: string, tools = true) {
  return { id, name, supported_parameters: tools ? ["tools", "temperature"] : ["temperature"] };
}

describe("parseOpenRouterModels", () => {
  it("keeps only models that support tool calling", () => {
    const parsed = parseOpenRouterModels({
      data: [model("a/one", "One"), model("b/two", "Two", false), model("c/three", "Three")],
    });
    // A model without tool support can't run the agent at all, so offering it
    // would be offering a broken choice.
    expect(parsed.map((m) => m.id)).toEqual(["a/one", "c/three"]);
  });

  it("falls back to the id when a model has no name", () => {
    const parsed = parseOpenRouterModels({ data: [{ id: "x/unnamed", supported_parameters: ["tools"] }] });
    expect(parsed[0].name).toBe("x/unnamed");
  });

  it("skips malformed entries instead of failing the whole catalogue", () => {
    const parsed = parseOpenRouterModels({
      data: [null, "nonsense", { supported_parameters: ["tools"] }, { id: "", supported_parameters: ["tools"] }, model("ok/one", "Ok")],
    });
    expect(parsed.map((m) => m.id)).toEqual(["ok/one"]);
  });

  it("returns nothing for a response of the wrong shape", () => {
    expect(parseOpenRouterModels({})).toEqual([]);
    expect(parseOpenRouterModels({ data: "not an array" })).toEqual([]);
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels(undefined)).toEqual([]);
  });

  it("treats a missing supported_parameters as no tool support", () => {
    expect(parseOpenRouterModels({ data: [{ id: "a/b", name: "AB" }] })).toEqual([]);
  });
});

describe("sortModels", () => {
  const openrouter = (id: string, name: string): CatalogueModel => ({ id, name, providerId: "openrouter" });

  it("sorts alphabetically by display name", () => {
    const sorted = sortModels([openrouter("z", "Zephyr"), openrouter("a", "Alpaca"), openrouter("m", "Mistral")]);
    expect(sorted.map((m) => m.name)).toEqual(["Alpaca", "Mistral", "Zephyr"]);
  });

  it("sorts case-insensitively", () => {
    // Vendors capitalise inconsistently; a naive sort puts every lowercase name
    // after every uppercase one and scatters the list.
    const sorted = sortModels([openrouter("1", "zeta"), openrouter("2", "Alpha"), openrouter("3", "beta")]);
    expect(sorted.map((m) => m.name)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("does not mutate the input", () => {
    const input = [openrouter("z", "Zephyr"), openrouter("a", "Alpaca")];
    sortModels(input);
    expect(input.map((m) => m.name)).toEqual(["Zephyr", "Alpaca"]);
  });

  it("handles an empty list", () => {
    expect(sortModels([])).toEqual([]);
  });
});

/**
 * The three non-OpenRouter catalogues publish no tool-calling flag, so these
 * parsers filter by id. That heuristic is the part worth pinning: too loose and
 * the picker offers embedding models that fail on the first tool call; too tight
 * and it hides models that work.
 */
describe("parseOpenAiModels", () => {
  const payload = (...ids: string[]) => ({ data: ids.map((id) => ({ id })) });

  it("keeps chat and reasoning families", () => {
    expect(parseOpenAiModels(payload("gpt-4o", "gpt-4o-mini", "o3", "o4-mini")).map((m) => m.id)).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "o3",
      "o4-mini",
    ]);
  });

  it("drops models that cannot run a turn", () => {
    expect(
      parseOpenAiModels(
        payload("text-embedding-3-small", "whisper-1", "dall-e-3", "gpt-4o-audio-preview", "tts-1", "omni-moderation-latest"),
      ),
    ).toEqual([]);
  });

  it("falls back to the id as the display name, since none is published", () => {
    expect(parseOpenAiModels(payload("gpt-4o"))[0].name).toBe("gpt-4o");
  });

  it("returns nothing for the wrong shape", () => {
    expect(parseOpenAiModels({})).toEqual([]);
    expect(parseOpenAiModels(null)).toEqual([]);
  });
});

describe("parseAnthropicModels", () => {
  it("prefers display_name over the id", () => {
    const parsed = parseAnthropicModels({
      data: [{ id: "claude-sonnet-4-5-20250929", display_name: "Claude Sonnet 4.5" }],
    });
    expect(parsed).toEqual([
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", providerId: "anthropic" },
    ]);
  });

  it("falls back to the id when display_name is absent", () => {
    expect(parseAnthropicModels({ data: [{ id: "claude-x" }] })[0].name).toBe("claude-x");
  });

  it("skips entries without an id", () => {
    expect(parseAnthropicModels({ data: [{ display_name: "No id" }, { id: "ok" }] }).map((m) => m.id)).toEqual(["ok"]);
  });
});

describe("parseGoogleModels", () => {
  const entry = (name: string, methods = ["generateContent"], displayName?: string) => ({
    name,
    displayName,
    supportedGenerationMethods: methods,
  });

  it("strips the models/ prefix from the id", () => {
    // Left in, the generateContent path becomes models/models/gemini-… and 404s.
    expect(parseGoogleModels({ models: [entry("models/gemini-2.5-flash")] })[0].id).toBe("gemini-2.5-flash");
  });

  it("drops anything that cannot generate content", () => {
    expect(parseGoogleModels({ models: [entry("models/text-embedding-004", ["embedContent"])] })).toEqual([]);
  });

  it("drops non-Gemini and pre-function-calling families", () => {
    expect(
      parseGoogleModels({ models: [entry("models/gemini-1.0-pro"), entry("models/aqa"), entry("models/gemini-2.5-pro")] }).map(
        (m) => m.id,
      ),
    ).toEqual(["gemini-2.5-pro"]);
  });

  it("prefers displayName", () => {
    expect(parseGoogleModels({ models: [entry("models/gemini-2.5-pro", ["generateContent"], "Gemini 2.5 Pro")] })[0].name).toBe(
      "Gemini 2.5 Pro",
    );
  });
});

describe("parseModels", () => {
  it("routes each provider to its own parser", () => {
    expect(parseModels("openrouter", { data: [{ id: "a/b", supported_parameters: ["tools"] }] })[0].providerId).toBe("openrouter");
    expect(parseModels("openai", { data: [{ id: "gpt-4o" }] })[0].providerId).toBe("openai");
    expect(parseModels("anthropic", { data: [{ id: "claude-x" }] })[0].providerId).toBe("anthropic");
    expect(parseModels("google", { models: [{ name: "models/gemini-2.5-pro" }] })[0].providerId).toBe("google");
  });
});
