/**
 * P6 (carried from P4): the phone's back button closes what is open before it leaves the game. Each open sheet or
 * dialog adds one entry to the browser's history; Back closes the one on top (and only that), the next Back the one
 * under it, and only with nothing open does Back leave the page, as it always did. Something closed in the page (its
 * close button, Escape) takes its own entry back quietly, so the history never fills with entries for closed things.
 */

const stack: Array<() => void> = [];
/**
 * What the history must do, in order. A back() goes to the entry before the one current when it is called, and moves
 * only on a later task (Chrome, traced 2026-11-24): a pushState made in between was skipped over, so the history fell a
 * step behind, and the next close went back out of the game to a blank page. So nothing touches the history while a
 * back of ours is on its way; what comes meanwhile waits here.
 */
type Op = { kind: "push" } | { kind: "back" };
const ops: Op[] = [];
let backing = false;
let listening = false;
/** the address's hash when our back left, and the one it landed on when that differs (it fires a hashchange) */
let hashBefore = "";
let landed: string | null = null;

function pump(): void {
  while (!backing && ops.length > 0) {
    const op = ops.shift()!;
    if (op.kind === "push") history.pushState({ lingxiBack: stack.length }, "");
    else {
      backing = true;
      hashBefore = location.hash;
      history.back();
    }
  }
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    // our own back, for something already closed, has arrived: what waited for it goes now
    if (backing) {
      backing = false;
      if (location.hash !== hashBefore) landed = location.hash;
      pump();
      return;
    }
    stack.pop()?.();
  });
}

/**
 * Something opened that Back should close: `close` is called when the player presses Back while it is on top. The
 * returned call is for when it closes in the page instead; it takes its history entry back, or, when that entry was
 * still waiting to be made, never makes it.
 */
export function onBack(close: () => void): () => void {
  listen();
  stack.push(close);
  const push: Op = { kind: "push" };
  ops.push(push);
  pump();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const at = stack.lastIndexOf(close);
    // already gone: Back closed it, and its entry went with that press
    if (at < 0) return;
    stack.splice(at, 1);
    const waiting = ops.indexOf(push);
    if (waiting >= 0) {
      ops.splice(waiting, 1);
      return;
    }
    ops.push({ kind: "back" });
    pump();
  };
}

/**
 * Whether the address's `hash` is one our own back landed on (taken once): a link reader reads a link the player
 * followed, not one that history handed back because something closed (P6: a duel link already answered reopened).
 */
export function takeOwnLanding(hash: string): boolean {
  if (landed === null || landed !== hash) return false;
  landed = null;
  return true;
}

/** How many open things Back would close, for tests. */
export const openForBack = (): number => stack.length;
