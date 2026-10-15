import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./network";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("backend request timeouts", () => {
  it("keeps normal requests bounded but allows publishing to finish after eight seconds", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const responses: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise<Response>((resolve) => {
      signals.push(init.signal); responses.push(resolve);
    })));
    const normal = fetchWithTimeout("https://example.com/rest/v1/family_trees");
    const publish = fetchWithTimeout("https://example.com/functions/v1/github-publish-tree");
    await vi.advanceTimersByTimeAsync(8_001);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    responses.forEach((resolve) => resolve(new Response("ok")));
    await Promise.all([normal, publish]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("still bounds a stalled publication", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((_input, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const request = fetchWithTimeout("https://example.com/functions/v1/github-publish-tree");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal!.aborted).toBe(true);
    finish(new Response()); await request;
  });
  it("honors caller cancellation and clears the timeout on completion", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_input, init) => {
      caller.abort();
      expect(init.signal.aborted).toBe(true);
      return Promise.resolve(new Response());
    }));
    await fetchWithTimeout("https://example.com/rest/v1/family_trees", { signal: caller.signal });
    expect(vi.getTimerCount()).toBe(0);
  });
});
