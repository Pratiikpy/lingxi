/**
 * P6 (carried from P4): the phone's back button closes what is open before it leaves the game. Each open sheet or
 * dialog adds one entry to the browser's history; Back closes the one on top (and only that), the next Back the one
 * under it, and only with nothing open does Back leave the page, as it always did. Something closed in the page (its
 * close button, Escape) takes its own entry back quietly, so the history never fills with entries for closed things.
 */

const stack: Array<() => void> = [];
let quiet = 0;
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    // an entry taken back by the page itself, for something already closed
    if (quiet > 0) {
      quiet--;
      return;
    }
    stack.pop()?.();
  });
}

/**
 * Something opened that Back should close: `close` is called when the player presses Back while it is on top. The
 * returned call is for when it closes in the page instead; it takes its history entry back.
 */
export function onBack(close: () => void): () => void {
  listen();
  stack.push(close);
  history.pushState({ lingxiBack: stack.length }, "");
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const at = stack.lastIndexOf(close);
    // already gone: Back closed it, and its entry went with that press
    if (at < 0) return;
    stack.splice(at, 1);
    quiet++;
    history.back();
  };
}

/** How many open things Back would close, for tests. */
export const openForBack = (): number => stack.length;
