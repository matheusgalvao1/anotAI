import { classifyHttpError, httpErrorKind, isModelNotFoundError, isToolSupportError } from "./transport";

/**
 * Coverage for the shared error classifier. It exists because a provider refusing
 * tool use arrives as a bare 400 with the reason only in prose, so the status
 * alone maps it to "unknown" and the user sees a raw API sentence.
 *
 * The heuristic here is deliberately narrow, and these tests are mostly about
 * where it must *not* fire: over-matching would tell someone to change model when
 * the real problem was their request.
 */

describe("httpErrorKind", () => {
  it("maps the statuses that speak for themselves", () => {
    expect(httpErrorKind(401)).toBe("auth");
    expect(httpErrorKind(403)).toBe("auth");
    expect(httpErrorKind(402)).toBe("insufficient_credits");
    expect(httpErrorKind(429)).toBe("rate_limit");
    expect(httpErrorKind(404)).toBe("not_found");
  });

  it("does not guess at a 400, which needs the message", () => {
    expect(httpErrorKind(400)).toBe("unknown");
  });
});

describe("isToolSupportError", () => {
  it("recognises OpenAI's refusal for reasoning models", () => {
    // Verbatim from a live run against a reasoning model — the string this was
    // written for.
    expect(
      isToolSupportError(
        400,
        "Function tools with reasoning_effort are not supported for gpt-5.6-luna in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
      ),
    ).toBe(true);
  });

  it("recognises the other common phrasings", () => {
    expect(isToolSupportError(400, "This model does not support tools.")).toBe(true);
    expect(isToolSupportError(400, "Unsupported parameter: 'tools'")).toBe(true);
  });

  it("needs both a mention of tools and a refusal", () => {
    // A refusal about something else entirely.
    expect(isToolSupportError(400, "The requested temperature is not supported.")).toBe(false);
    // Tools mentioned, but the complaint is the caller's malformed input.
    expect(isToolSupportError(400, "Invalid schema for function 'rewrite_note': missing 'type'.")).toBe(false);
  });

  it("only ever fires on a 400", () => {
    // A 401 saying anything at all is still an auth problem; telling the user to
    // change model would send them to the wrong Settings field.
    expect(isToolSupportError(401, "This model does not support tools.")).toBe(false);
    expect(isToolSupportError(500, "tools are not supported")).toBe(false);
  });
});

describe("isModelNotFoundError", () => {
  it("recognises the Responses API's 400 for an unknown model", () => {
    // Verbatim from /v1/responses, which answers 400 where chat-completions 404s.
    expect(isModelNotFoundError(400, "The requested model 'nope-not-real' does not exist.")).toBe(true);
  });

  it("needs the complaint to be about a model", () => {
    expect(isModelNotFoundError(400, "The requested file does not exist.")).toBe(false);
  });

  it("only ever fires on a 400, since 404 already means this", () => {
    expect(isModelNotFoundError(404, "model does not exist")).toBe(false);
  });
});

describe("classifyHttpError", () => {
  it("prefers the tool diagnosis over the generic 400", () => {
    expect(classifyHttpError(400, "tools are not supported for this model")).toBe("no_tool_support");
  });

  it("maps the Responses API's unknown-model 400 to not_found", () => {
    expect(classifyHttpError(400, "The requested model 'nope' does not exist.")).toBe("not_found");
  });

  /**
   * "Function tools ... are not supported for <model>" names a model too, so the
   * order of these two checks decides which advice the user gets. Telling them
   * the model doesn't exist, when it does and simply can't do tools, sends them
   * hunting for a typo that isn't there.
   */
  it("calls a tool refusal a tool refusal, even though it names a model", () => {
    expect(
      classifyHttpError(400, "Function tools with reasoning_effort are not supported for gpt-5.6-luna."),
    ).toBe("no_tool_support");
  });

  it("otherwise agrees with the status-only mapping", () => {
    expect(classifyHttpError(400, "something else went wrong")).toBe("unknown");
    expect(classifyHttpError(404, "model: claude-haiku-4.5")).toBe("not_found");
    expect(classifyHttpError(429, "rate limited")).toBe("rate_limit");
  });
});
