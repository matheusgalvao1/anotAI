import { ProviderError } from "../types";

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

export function resolveFetch(injected?: FetchLike): FetchLike | undefined {
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
 * Reads an error body without assuming a shape. OpenAI-compatible endpoints and
 * Anthropic both nest under `error.message`; Google returns `error.message` too
 * but sometimes as an array of details. Anything unrecognised falls back to the
 * caller's generic message rather than showing the user raw JSON.
 */
export async function readErrorMessage(response: FetchLikeResponse, fallback: string): Promise<string> {
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
