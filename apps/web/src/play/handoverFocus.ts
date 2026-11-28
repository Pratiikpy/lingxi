/**
 * R58: the keyboard's place kept across a first visit's handover. A first visit draws the hatch screen on its own, and
 * once the rest of the game has loaded the page hands over to the full game, which draws the same screen again
 * (FirstVisit.tsx). That swap replaced every control, so a keyboard or screen-reader player lost their place mid-way
 * (the focus fell to the page) and a key pressed just then did nothing. Where the focus was is noted before the swap,
 * and the full game's hatch screen puts it back on the same control once it is drawn, the caret too in the name box.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** A control, told apart from the others the way the same screen drawn again will draw it. */
interface Place {
  index: number;
  tag: string;
  cls: string;
  text: string;
  start: number | null;
  end: number | null;
}

let kept: Place | null = null;

const focusables = (root: Element): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
const sameControl = (el: HTMLElement, p: Place) =>
  el.tagName === p.tag && el.className === p.cls && textOf(el) === p.text;

/** Notes where the focus is inside `root` (the hatch screen), to be put back once the full game has drawn it again. */
export function keepFocus(root: Element | null): void {
  kept = null;
  const at = document.activeElement;
  if (!root || !(at instanceof HTMLElement) || !root.contains(at)) return;
  const index = focusables(root).indexOf(at);
  if (index < 0) return;
  const input = at instanceof HTMLInputElement ? at : null;
  kept = {
    index,
    tag: at.tagName,
    cls: at.className,
    text: textOf(at),
    start: input?.selectionStart ?? null,
    end: input?.selectionEnd ?? null,
  };
}

/**
 * Puts a kept focus back on the same control of `root`, once: the control at the same place if it is the same kind
 * with the same words, else the first such control; nothing when none was kept or none matches. Says whether it did.
 */
export function restoreFocus(root: Element | null): boolean {
  const p = kept;
  kept = null;
  if (!p || !root) return false;
  const all = focusables(root);
  const at = all[p.index];
  const el = at && sameControl(at, p) ? at : all.find((e) => sameControl(e, p));
  if (!el) return false;
  el.focus({ preventScroll: true });
  if (el instanceof HTMLInputElement && p.start !== null) el.setSelectionRange(p.start, p.end ?? p.start);
  return document.activeElement === el;
}

/** Tests only: whether a place is kept. */
export const focusKept = (): boolean => kept !== null;
