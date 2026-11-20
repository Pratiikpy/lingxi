/**
 * A15: the room's notices in one lane. The quest toast, a badge, the pet's own line and the rules mark used to place
 * themselves, each at its own height, and on a phone they piled on each other and on the room's buttons. Here they
 * stack in one column, in that order, under the room's top row and clear of the pet's "!" corner, wherever the room
 * is on the page; above sheets, as the quest and badge toasts always were. Where the lane goes is measured from the
 * room as it is laid out and written straight to the lane's style, so a resize never re-renders the game.
 *
 * A67: while a sheet is open the lane moves under that sheet's header and centres on it, so a notice never covers
 * its title or its close button. The sheet is read from its layout (offsets, which leave out the slide it opens with),
 * so the lane goes where the sheet will settle, and it follows sheets opening, closing and changing height.
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./notice-lane.css";

/** Room for the pet's "!" (and the circuit button above it) at the room's right edge. */
const CORNER = 64;
/** Space between the room's top row and the first notice, and at the room's left edge. */
const GAP = 8;

export function NoticeLane({ children }: { children: ReactNode }) {
  const lane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = lane.current;
    if (!el) return;
    const place = () => {
      // an open sheet, the newest on top: notices go under its header
      const sheets = document.querySelectorAll<HTMLElement>(".sheet");
      const sheet = sheets[sheets.length - 1];
      const head = sheet?.querySelector<HTMLElement>(".shead");
      if (sheet && head) {
        const top = sheet.offsetTop + sheet.clientTop + head.offsetTop + head.offsetHeight + GAP;
        el.style.setProperty("--lane-top", `${Math.round(top)}px`);
        el.style.setProperty("--lane-left", `${Math.round(sheet.offsetLeft + GAP)}px`);
        el.style.setProperty("--lane-width", `${Math.max(0, Math.round(sheet.offsetWidth - 2 * GAP))}px`);
        sized.observe(sheet);
        return;
      }
      const room = document.querySelector<HTMLElement>(".stage");
      if (!room) return;
      const r = room.getBoundingClientRect();
      const row = room.querySelector<HTMLElement>(".room-pill")?.getBoundingClientRect();
      // under the top row when it shows (it wraps to two lines on a phone), else at the room's top
      const top = Math.max(r.top, row && row.height > 0 ? row.bottom : r.top) + GAP;
      el.style.setProperty("--lane-top", `${Math.round(top)}px`);
      el.style.setProperty("--lane-left", `${Math.round(r.left + GAP)}px`);
      el.style.setProperty("--lane-width", `${Math.max(0, Math.round(r.width - GAP - CORNER))}px`);
    };
    // a sheet growing or shrinking moves its header
    const sized = new ResizeObserver(() => place());
    place();
    const watch = new ResizeObserver(place);
    // sheets open and close anywhere in the page: placed again on the next frame after any change to the tree
    let queued = 0;
    const opened = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        place();
      });
    });
    opened.observe(document.body, { childList: true, subtree: true });
    const room = document.querySelector<HTMLElement>(".stage");
    if (room) watch.observe(room);
    const row = room?.querySelector<HTMLElement>(".room-pill");
    if (row) watch.observe(row);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      watch.disconnect();
      sized.disconnect();
      opened.disconnect();
      cancelAnimationFrame(queued);
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, []);
  return (
    <div ref={lane} className="notice-lane">
      {children}
    </div>
  );
}
