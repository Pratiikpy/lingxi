/**
 * R36: whether a dialog lies over the room (family.css's .fam-modal: a quest's lines, a gift, a proposal, a newborn, a
 * welcome back). A dozen parts of the game each draw their own, so it is read from the page, as NoticeLane reads it to
 * put the notices under the dialog's dim (R35). PlayApp uses it to keep the pet's passing words waiting while one is
 * open: under the dim its bubble, drawn near white in both themes, was still the brightest thing behind the dialog
 * (brighter than a dark dialog's own card), and the pet seemed to say two things at once.
 */
import { useSyncExternalStore } from "react";

const dialogOpen = (): boolean => !!document.querySelector(".fam-modal");

/** Any dialog opening or closing anywhere in the page; a change that is not one costs a selector and no render. */
function subscribe(changed: () => void): () => void {
  const watch = new MutationObserver(changed);
  watch.observe(document.body, { childList: true, subtree: true });
  return () => watch.disconnect();
}

export function useDialogOpen(): boolean {
  return useSyncExternalStore(subscribe, dialogOpen, () => false);
}
