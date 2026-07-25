import { Provider, ProviderRequest, ProviderStreamEvent } from "../types";

/**
 * Deterministic Provider for tests. Each entry in `script` is the full set of
 * stream events for one request; `send()` is called once per loop iteration,
 * so `script[i]` corresponds to the model's i-th response in a turn.
 *
 * Pass a function instead of an event array to make a turn's response depend
 * on what was sent (e.g. to assert which tools were offered).
 */
export type ScriptEntry = ProviderStreamEvent[] | ((req: ProviderRequest) => ProviderStreamEvent[]);

export class ScriptedProvider implements Provider {
  readonly id = "mock";
  private callIndex = 0;
  readonly requests: ProviderRequest[] = [];

  constructor(private script: ScriptEntry[]) {}

  async *send(req: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    this.requests.push(req);
    const entry = this.script[this.callIndex] ?? [];
    this.callIndex++;

    const events = typeof entry === "function" ? entry(req) : entry;
    for (const event of events) {
      if (req.signal.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }
      yield event;
    }
  }
}
