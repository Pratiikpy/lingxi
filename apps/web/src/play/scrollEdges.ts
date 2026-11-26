/**
 * R23: a box that scrolls on its own says which of its edges hide more, so its stylesheet can fade that edge rather
 * than slice a row in two with nothing to show there is more. The answer is written to the box as `data-more`
 * ("none", "below", "above" or "both"), straight to the element, so a scroll never re-renders the game.
 */
import { type RefObject, useLayoutEffect } from "react";

export type More = "none" | "below" | "above" | "both";

/** A pixel of slack: a zoomed page scrolls in fractions, and a box at its end may stop a fraction short. */
const SLACK = 1;

export function moreOf(scrollTop: number, clientHeight: number, scrollHeight: number): More {
  const above = scrollTop > SLACK;
  const below = scrollTop + clientHeight < scrollHeight - SLACK;
  if (above && below) return "both";
  if (above) return "above";
  if (below) return "below";
  return "none";
}

/** Keeps `data-more` on the box true as it scrolls, resizes, or its contents change. */
export function useScrollEdges(box: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const mark = () => {
      el.setAttribute("data-more", moreOf(el.scrollTop, el.clientHeight, el.scrollHeight));
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    // the box resizing (the window, the side column), and its contents growing as the pet learns a rule
    const sized = new ResizeObserver(mark);
    sized.observe(el);
    for (const child of Array.from(el.children)) sized.observe(child);
    const changed = new MutationObserver(() => {
      for (const child of Array.from(el.children)) sized.observe(child);
      mark();
    });
    changed.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", mark);
      sized.disconnect();
      changed.disconnect();
    };
  }, [box]);
}
