import { parseSelection } from "./modelSelection";

/**
 * A stored selection is untrusted: it can be corrupt, hand-edited, or written by
 * a future version of the app. Every bad shape has to read as "nothing
 * selected", because throwing here happens during Settings' first render and
 * would take the screen down with it.
 */
describe("parseSelection", () => {
  it("reads a well-formed selection", () => {
    expect(parseSelection('{"providerId":"openrouter","modelId":"openai/gpt-4o-mini"}')).toEqual({
      providerId: "openrouter",
      modelId: "openai/gpt-4o-mini",
    });
  });

  it("returns null for nothing stored", () => {
    expect(parseSelection(null)).toBeNull();
    expect(parseSelection("")).toBeNull();
  });

  it("returns null rather than throwing on malformed JSON", () => {
    expect(parseSelection("{not json")).toBeNull();
  });

  it("rejects an unknown provider id", () => {
    // Guards a downgrade after a new provider ships: an id this build doesn't
    // know must not be treated as configured. ("anthropic" is a real id now, so
    // this deliberately uses one that isn't.)
    expect(parseSelection('{"providerId":"mistral","modelId":"mistral-large"}')).toBeNull();
  });

  it("rejects a missing or empty model id", () => {
    expect(parseSelection('{"providerId":"openrouter"}')).toBeNull();
    expect(parseSelection('{"providerId":"openrouter","modelId":""}')).toBeNull();
  });

  it("rejects values of the wrong type", () => {
    expect(parseSelection('"just a string"')).toBeNull();
    expect(parseSelection("42")).toBeNull();
    expect(parseSelection("null")).toBeNull();
    expect(parseSelection('{"providerId":"openrouter","modelId":42}')).toBeNull();
  });
});
