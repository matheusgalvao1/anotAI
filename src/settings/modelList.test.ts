import { CatalogueModel, parseOpenRouterModels, sortModels } from "./modelList";

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
