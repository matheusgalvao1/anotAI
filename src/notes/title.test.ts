import { deriveTitleAndPreview } from "./title";

describe("deriveTitleAndPreview", () => {
  it("uses the first non-empty line as the title", () => {
    expect(deriveTitleAndPreview("Groceries\n- eggs\n- bread")).toEqual({
      title: "Groceries",
      preview: "- eggs",
    });
  });

  it("strips leading heading markers", () => {
    expect(deriveTitleAndPreview("## Meeting notes\nDiscussed roadmap")).toEqual({
      title: "Meeting notes",
      preview: "Discussed roadmap",
    });
  });

  it("skips leading blank lines", () => {
    expect(deriveTitleAndPreview("\n\n  Trip plan  \nBook flights")).toEqual({
      title: "Trip plan",
      preview: "Book flights",
    });
  });

  it("returns 'New Note' for an empty body", () => {
    expect(deriveTitleAndPreview("")).toEqual({ title: "New Note", preview: "" });
  });

  it("returns 'New Note' for a body that is only whitespace", () => {
    expect(deriveTitleAndPreview("   \n\t\n  ")).toEqual({ title: "New Note", preview: "" });
  });

  it("returns 'New Note' when the only line is just heading markers", () => {
    expect(deriveTitleAndPreview("###")).toEqual({ title: "New Note", preview: "" });
  });

  it("has no preview when there's only a title line", () => {
    expect(deriveTitleAndPreview("Just a title")).toEqual({ title: "Just a title", preview: "" });
  });

  it("truncates a very long title", () => {
    const longLine = "x".repeat(150);
    const result = deriveTitleAndPreview(longLine);
    expect(result.title).toHaveLength(100);
  });
});
