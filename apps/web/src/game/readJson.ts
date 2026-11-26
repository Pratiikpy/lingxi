/**
 * R33: one of the server's answers, read as JSON by a page that shows it (the numbers, the tree of life), giving up when
 * the server does not answer. A server that never answered left "Reading the chain…" on those pages for good; the server
 * answers from its own copy, at most a minute old, in well under a second, so fifteen seconds is a server not coming.
 */
export const READ_TIMEOUT_MS = 15_000;

/** Fetches `url` fresh and reads it as JSON; rejects on a failed fetch, a body that is not JSON, or no answer in time. */
export async function readJson<T>(url: string): Promise<T> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), READ_TIMEOUT_MS);
  try {
    return (await (await fetch(url, { cache: "no-store", signal: stop.signal })).json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
