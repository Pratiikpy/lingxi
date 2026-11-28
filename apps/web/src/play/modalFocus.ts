/**
 * P5: the keyboard's focus and the game's dialogs, for every dialog at once. While a dialog marked `aria-modal="true"`
 * is open, Tab and Shift+Tab move only among its own controls (the one on top, when several are open); a dialog that
 * appears takes the focus, and gives it back to where it was when it goes. Sheets (Sheets.tsx) move the focus in and
 * back out themselves; for them this only keeps Tab inside. The back button closes a dialog through its close button
 * (P6, backStack.ts); sheets register with the back button themselves. R73: and Escape takes the same way out as
 * Back, on the dialog on top: its close button, or the choice marked `data-dismiss` ("I'll wait", "OK", "Later") where
 * it has no close button. A dialog that asks for an answer has neither, and Escape answers nothing for the player.
 */
import { onBack } from "../game/backStack";

const MODAL = '[aria-modal="true"]';
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
/** A dialog's own close button, in either language (the game's "close" string). */
const CLOSE = 'button[aria-label="Close"], button[aria-label="关闭"]';
/** A dialog's way out: its close button, or the choice that leaves it as it was (R73). */
const WAY_OUT = `${CLOSE}, button[data-dismiss]`;

/** The controls the keyboard can reach inside `box`, in order. */
export function focusables(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      el.tabIndex >= 0 &&
      !el.closest("[inert]") &&
      el.getClientRects().length > 0,
  );
}

/** The open dialog on top: the highest stacking order, and of equals the one later on the page. */
export function topModal(doc: Document = document): HTMLElement | null {
  const open = Array.from(doc.querySelectorAll<HTMLElement>(MODAL)).filter((el) => el.getClientRects().length > 0);
  let top: HTMLElement | null = null;
  let topZ = -Infinity;
  for (const el of open) {
    const z = Number.parseInt(getComputedStyle(el).zIndex, 10);
    const zi = Number.isFinite(z) ? z : 0;
    if (zi >= topZ) {
      top = el;
      topZ = zi;
    }
  }
  return top;
}

/** Keeps a Tab press inside `box`: from its last control to its first and back, and a stray focus brought in. */
export function trapTab(e: Pick<KeyboardEvent, "shiftKey" | "preventDefault">, box: HTMLElement): void {
  const all = focusables(box);
  if (!all.length) {
    e.preventDefault();
    return;
  }
  const first = all[0]!;
  const last = all[all.length - 1]!;
  const at = box.ownerDocument.activeElement;
  if (!at || !box.contains(at)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && at === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Starts watching the page's dialogs; returns the call that stops it. */
export function installModalFocus(doc: Document = document): () => void {
  // R73: Escape leaves the dialog on top by its way out; a sheet closes itself (Sheets.tsx), and one under the dialog
  // never hears this Escape, so one press closes one thing
  const leave = (e: KeyboardEvent) => {
    const top = topModal(doc);
    if (!top || top.classList.contains("sheet")) return;
    const out = top.querySelector<HTMLButtonElement>(WAY_OUT);
    if (!out || out.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    out.click();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return leave(e);
    if (e.key !== "Tab") return;
    const top = topModal(doc);
    if (top) trapTab(e, top);
  };
  // a dialog that is not a sheet takes the focus when it appears, and gives it back when it goes
  const returnTo = new Map<HTMLElement, HTMLElement | null>();
  // P6: and the back button: a dialog with a way out is left by it (R73); one that asks for an answer keeps Back
  // (the dialog stays, and the game is not left behind a question nobody answered)
  const backOff = new Map<HTMLElement, () => void>();
  const holdBack = (el: HTMLElement) => {
    backOff.set(
      el,
      onBack(() => {
        if (!el.isConnected) return;
        const close = el.querySelector<HTMLButtonElement>(WAY_OUT);
        if (close) close.click();
        else holdBack(el);
      }),
    );
  };
  const arrived = (el: HTMLElement) => {
    if (el.classList.contains("sheet") || returnTo.has(el)) return;
    holdBack(el);
    const was = doc.activeElement as HTMLElement | null;
    returnTo.set(el, was && !el.contains(was) ? was : null);
    if (!el.contains(doc.activeElement)) {
      const first = focusables(el)[0];
      if (first) first.focus();
      else {
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.focus();
      }
    }
  };
  const scan = () => {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(MODAL))) arrived(el);
    for (const [el, was] of [...returnTo]) {
      if (el.isConnected) continue;
      returnTo.delete(el);
      backOff.get(el)?.();
      backOff.delete(el);
      // only when the focus went down with the dialog: a player who has moved on is not pulled back
      const at = doc.activeElement;
      if (was?.isConnected && (!at || at === doc.body)) was.focus();
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(doc.body, { childList: true, subtree: true });
  doc.addEventListener("keydown", onKey, true);
  scan();
  return () => {
    observer.disconnect();
    doc.removeEventListener("keydown", onKey, true);
  };
}
