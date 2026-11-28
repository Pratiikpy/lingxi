/**
 * R60: a part that appears in answer to a tap, out of sight further down a sheet (Pet School's lesson card, drawn a
 * screen and a half below the level that was tapped), is brought into view inside its own scrolling box and given the
 * focus, so the tap visibly answers and the keyboard and a screen reader are where the player now is. Only that box
 * moves, never the page behind the sheet; with reduced motion it jumps instead of gliding.
 */

/** Room left between the part and the box's edge, so it does not sit flush against the sheet's head or its foot. */
const EDGE = 16;

/** The nearest ancestor that scrolls its own content (a sheet's body), or null when the part is on the page itself. */
export function scrollingBox(el: HTMLElement): HTMLElement | null {
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(box).overflowY)) return box;
  }
  return null;
}

/** Whether the player asked for less motion: read when it is needed, so a change in the system's setting counts. */
export const prefersLessMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The scroll that shows `part` whole inside `box`, the least movement that does it (a part taller than the box shows
 * from its top); null when it already shows.
 */
export function scrollToShow(
  box: DOMRect | DOMRectReadOnly,
  part: DOMRect | DOMRectReadOnly,
  now: number,
): number | null {
  const room = box.height - 2 * EDGE;
  if (part.top < box.top + EDGE || part.height > room) return now + part.top - box.top - EDGE;
  if (part.bottom > box.bottom - EDGE) return now + part.bottom - box.bottom + EDGE;
  return null;
}

/** How long a jump keeps its target in place while the panels round it finish loading. */
const SETTLE_MS = 1500;

/**
 * R72: panels in a long sheet load as they come near the view and grow from their held height, so a part jumped to
 * moved off as the ones above it arrived (Chrome's scroll anchoring did not hold it). For a moment after a jump, each
 * change in the box's size puts the part back where the jump left it, until the player scrolls or taps themselves.
 */
function holdInPlace(box: HTMLElement, part: HTMLElement, offset: number): void {
  if (typeof ResizeObserver === "undefined") return;
  const put = () => {
    const off = part.getBoundingClientRect().top - box.getBoundingClientRect().top - offset;
    if (Math.abs(off) > 1) box.scrollTo({ top: box.scrollTop + off, behavior: "instant" });
  };
  const sized = new ResizeObserver(put);
  for (const child of Array.from(box.children)) sized.observe(child);
  const stop = () => {
    sized.disconnect();
    clearTimeout(timer);
    for (const kind of LET_GO) box.removeEventListener(kind, stop);
  };
  const timer = setTimeout(stop, SETTLE_MS);
  for (const kind of LET_GO) box.addEventListener(kind, stop, { passive: true, once: true });
}
/** what says the player has taken the box over from the jump */
const LET_GO = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Brings `part` into view in its scrolling box, then gives it (or `focus`, a control inside it) the focus without
 * scrolling anything again. `start` puts it at the box's top (R72: a jump from a list of parts), `jump` moves there at
 * once, as an in-page link does, and keeps it there while what is round it settles.
 */
export function bringIntoView(
  part: HTMLElement,
  { start = false, jump = false, focus = part }: { start?: boolean; jump?: boolean; focus?: HTMLElement } = {},
): void {
  const box = scrollingBox(part);
  if (box) {
    const b = box.getBoundingClientRect();
    const r = part.getBoundingClientRect();
    const top = start ? box.scrollTop + r.top - b.top - EDGE : scrollToShow(b, r, box.scrollTop);
    if (top !== null) box.scrollTo({ top, behavior: jump || prefersLessMotion() ? "instant" : "smooth" });
    // a jump has landed by now: where it left the part is where it is held
    if (jump) holdInPlace(box, part, part.getBoundingClientRect().top - box.getBoundingClientRect().top);
  }
  focus.focus({ preventScroll: true });
}
