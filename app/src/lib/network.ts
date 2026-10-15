const REQUEST_TIMEOUT_MS = 8_000;
const PUBLISH_TIMEOUT_MS = 120_000;

export async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const timeoutMs = url.pathname.endsWith("/functions/v1/github-publish-tree") ? PUBLISH_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abort();
  else upstreamSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abort);
  }
}
