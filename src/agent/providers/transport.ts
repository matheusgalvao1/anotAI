import { ProviderError, ProviderStreamEvent } from "../types";

/**
 * The pieces every provider adapter needs from the network, in one place so the
 * four of them can't drift on the parts that have already cost debugging time:
 * how cancellation is detected, and how an SSE byte stream becomes events.
 */

/**
 * The subset of `fetch` the adapters need, kept structural on purpose: it has
 * to accept the platform `fetch`, `expo/fetch` (whose `Response` is its own
 * class, not the DOM one), and a plain stub in tests — without the agent core
 * importing anything platform-specific to describe them.
 */
export type FetchLikeInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export type FetchLikeResponse = {
  ok: boolean;
  status: number;
  /** Null whenever the implementation can't stream, which the adapters report rather than hiding. */
  body: ReadableStream<Uint8Array> | null;
  json: () => Promise<unknown>;
};

export type FetchLike = (url: string, init?: FetchLikeInit) => Promise<FetchLikeResponse>;

function resolveFetch(injected?: FetchLike): FetchLike | undefined {
  return injected ?? (typeof globalThis.fetch === "function" ? (globalThis.fetch as unknown as FetchLike) : undefined);
}

export function toTransportError(err: unknown, signal?: AbortSignal): ProviderError {
  // An aborted signal is the reliable evidence, not the error's shape. Every
  // transport words cancellation differently — the DOM throws an `AbortError`,
  // while `expo/fetch` throws `Expo.FetchRequestCanceledException`, whose name
  // matches nothing — and matching on names leaked a raw native message to the
  // user whenever a new transport appeared.
  //
  // An adapter still can't know *why* the signal fired: a user tapping cancel
  // and a deadline elapsing look identical here. Report the neutral fact and let
  // the caller, which owns the abort reason, decide how to describe it.
  if (signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
    return { kind: "cancelled", message: "The request was cancelled." };
  }
  return { kind: "network", message: err instanceof Error ? err.message : "Network request failed." };
}

/** HTTP status → error kind. Shared so one provider can't quietly disagree about what 429 means. */
export function httpErrorKind(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "insufficient_credits";
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  return "unknown";
}

/**
 * Whether a 400 is the provider saying this model can't use tools *here*.
 *
 * Status alone can't tell: every "you asked for something this model won't do"
 * arrives as a generic 400 with the reason only in prose, so this reads the
 * message. That is a heuristic and deliberately a narrow one — it requires both
 * a mention of tools and an explicit refusal, and the provider's own message is
 * always kept alongside the kind so a miss degrades to showing the real text
 * rather than to a wrong diagnosis.
 *
 * The case that motivated it: OpenAI's reasoning models reject tools on
 * /v1/chat/completions entirely ("Function tools with reasoning_effort are not
 * supported for <model> in /v1/chat/completions"), which surfaced to the user as
 * a raw API sentence with no hint that picking another model would fix it.
 */
export function isToolSupportError(status: number, message: string): boolean {
  if (status !== 400) return false;
  const m = message.toLowerCase();
  const mentionsTools = m.includes("tool") || m.includes("function");
  const refuses = m.includes("not supported") || m.includes("unsupported") || m.includes("does not support");
  return mentionsTools && refuses;
}

/**
 * Whether a 400 is the provider saying it has never heard of this model.
 *
 * Most endpoints answer an unknown model with a 404, which needs no help.
 * OpenAI's `/v1/responses` answers with a **400** — "The requested model 'x'
 * does not exist." — so without this a typo'd model id reads as a generic
 * failure and the user is shown raw API prose instead of being sent to the
 * model field in Settings.
 */
export function isModelNotFoundError(status: number, message: string): boolean {
  if (status !== 400) return false;
  const m = message.toLowerCase();
  if (!m.includes("model")) return false;
  return m.includes("does not exist") || m.includes("not found") || m.includes("unknown model");
}

/**
 * The kind for a failed HTTP response, given both the status and what the body
 * said. Prefer this to `httpErrorKind` at an adapter's error boundary: status is
 * enough for the well-known codes, but not for the 400s that only differ in prose.
 *
 * Tool support is checked first: "function tools ... are not supported for
 * <model>" names a model too, and the useful advice there is to change model
 * because of what it can't do, not because it doesn't exist.
 */
export function classifyHttpError(status: number, message: string): ProviderError["kind"] {
  if (isToolSupportError(status, message)) return "no_tool_support";
  if (isModelNotFoundError(status, message)) return "not_found";
  return httpErrorKind(status);
}

/**
 * Reads an error body without assuming a shape. OpenAI-compatible endpoints and
 * Anthropic both nest under `error.message`; Google returns `error.message` too
 * but sometimes as an array of details. Anything unrecognised falls back to the
 * caller's generic message rather than showing the user raw JSON.
 */
async function readErrorMessage(response: FetchLikeResponse, fallback: string): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: unknown } | string };
    if (typeof json?.error === "string" && json.error.length > 0) return json.error;
    const message = (json?.error as { message?: unknown })?.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch {
    // Body wasn't JSON — keep the generic message.
  }
  return fallback;
}

/**
 * A usage event, or null when there is nothing worth reporting.
 *
 * Shared because the adapters had drifted: two suppressed an all-zero reading
 * and one emitted it, so the same silent stream produced different event
 * sequences depending on the provider. Nothing consumes usage yet — per-turn
 * cost is deferred (PRD §13) — which is the reason to settle the shape now,
 * while no caller depends on it.
 */
export function usageEvent(input: unknown, output: unknown): ProviderStreamEvent | null {
  const inputTokens = Number(input ?? 0);
  const outputTokens = Number(output ?? 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  if (inputTokens + outputTokens <= 0) return null;
  return { type: "usage", inputTokens, outputTokens };
}

/**
 * The request every adapter makes, and the three failures they all share:
 * no fetch was injected, the response was not ok, and the transport returned a
 * body that can't be streamed.
 *
 * Each adapter had its own copy of this — same logic, same wording, three
 * chances to drift. It resolves to the stream to parse, or the single error
 * event to yield instead, so the caller stays a straight line.
 */
export async function openProviderStream(opts: {
  url: string;
  init: FetchLikeInit;
  /** Names the provider in error text, so a failure blames whoever actually failed. */
  displayName: string;
  fetch?: FetchLike;
}): Promise<{ stream: ReadableStream<Uint8Array> } | { error: ProviderError }> {
  const doFetch = resolveFetch(opts.fetch);
  if (!doFetch) {
    return {
      error: { kind: "network", message: "No fetch implementation available. Pass one via the provider options." },
    };
  }

  let response: FetchLikeResponse;
  try {
    response = await doFetch(opts.url, opts.init);
  } catch (err) {
    return { error: toTransportError(err, opts.init.signal) };
  }

  if (!response.ok) {
    const message = await readErrorMessage(response, `${opts.displayName} request failed (HTTP ${response.status}).`);
    return { error: { kind: classifyHttpError(response.status, message), message, status: response.status } };
  }

  // A successful response with no readable body means the fetch in use can't
  // stream. Reporting that as an HTTP error would blame the provider for a local
  // wiring problem ("request failed (HTTP 200)").
  if (!response.body) {
    return {
      error: {
        kind: "network",
        message:
          "The fetch implementation in use does not expose a streaming response body, so the model's reply cannot be read. Pass expo/fetch to the provider.",
      },
    };
  }

  return { stream: response.body };
}

/** Matches an SSE event separator: a blank line, in either LF or CRLF form. */
const EVENT_SEPARATOR = /\r?\n\r?\n/;

function splitFirstEvent(buffer: string): { event: string; rest: string } | null {
  const match = EVENT_SEPARATOR.exec(buffer);
  if (!match) return null;
  return { event: buffer.slice(0, match.index), rest: buffer.slice(match.index + match[0].length) };
}

/**
 * Yields each raw SSE event block from a byte stream.
 *
 * Two behaviours here were bugs once and must not regress: events can be split
 * across chunk boundaries, so the buffer is only consumed at separators; and a
 * stream that ends *without* a trailing blank line still holds one real event,
 * which is dropped if the buffer isn't flushed — losing the model's last text
 * delta, or a whole tool call.
 *
 * Read failures are deliberately allowed to propagate: aborting mid-stream
 * rejects the reader, and only the caller knows whether that was a cancellation.
 */
export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split = splitFirstEvent(buffer);
      while (split) {
        buffer = split.rest;
        yield split.event;
        split = splitFirstEvent(buffer);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/**
 * The `data:` payload of one SSE event, or null for anything without one —
 * keep-alive comments (`: ping`), bare `event:` lines, and the `[DONE]`
 * terminator all arrive as events with nothing to parse.
 */
export function sseData(event: string): string | null {
  const lines = event.split(/\r?\n/);
  const parts: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) parts.push(line.slice(5).trim());
  }
  if (parts.length === 0) return null;
  const data = parts.join("\n");
  return data === "[DONE]" || data.length === 0 ? null : data;
}

/** The `event:` name of an SSE event, which Anthropic relies on and OpenAI never sends. */
export function sseEventName(event: string): string | null {
  for (const line of event.split(/\r?\n/)) {
    if (line.startsWith("event:")) return line.slice(6).trim();
  }
  return null;
}
