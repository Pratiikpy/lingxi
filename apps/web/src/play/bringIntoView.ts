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

/** Brings `part` into view in its scrolling box, then gives it the focus without scrolling anything again. */
export function bringIntoView(part: HTMLElement): void {
  const box = scrollingBox(part);
  if (box) {
    const top = scrollToShow(box.getBoundingClientRect(), part.getBoundingClientRect(), box.scrollTop);
    if (top !== null) box.scrollTo({ top, behavior: prefersLessMotion() ? "instant" : "smooth" });
  }
  part.focus({ preventScroll: true });
}
