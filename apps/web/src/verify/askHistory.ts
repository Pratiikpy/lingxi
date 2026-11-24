/**
 * A31: a pet born or kept a moment ago is not indexed yet, so its proof page asks for its history again, every
 * `every` ms up to `retries` more times, while the answer is empty; it stops at the first history it gets.
 */

/** How often, and how many times, an empty history is asked for again: the indexer reads new blocks every 15 s. */
export const HISTORY_RETRY_MS = 15_000;
export const HISTORY_RETRIES = 8;

/** Asks with `fetchOnce` and hands each answer to `onRead` ("none" while empty); returns a function that stops it. */
export function askHistory<H>(
  fetchOnce: () => Promise<H | null | undefined>,
  onRead: (h: H | "none") => void,
  retries = HISTORY_RETRIES,
  every = HISTORY_RETRY_MS,
): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = (left: number) =>
    fetchOnce()
      .then((h) => h ?? null)
      .catch(() => null)
      .then((h) => {
        if (!live) return;
        onRead(h ?? "none");
        if (!h && left > 0) timer = setTimeout(() => void ask(left - 1), every);
      });
  void ask(retries);
  return () => {
    live = false;
    clearTimeout(timer);
  };
}
