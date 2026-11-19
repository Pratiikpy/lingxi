/**
 * A15: the room's notices in one lane. The quest toast, a badge, the pet's own line and the rules mark used to place
 * themselves, each at its own height, and on a phone they piled on each other and on the room's buttons. Here they
 * stack in one column, in that order, under the room's top row and clear of the pet's "!" corner, wherever the room
 * is on the page; above sheets, as the quest and badge toasts always were. Where the lane goes is measured from the
 * room as it is laid out and written straight to the lane's style, so a resize never re-renders the game.
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
    place();
    const watch = new ResizeObserver(place);
    const room = document.querySelector<HTMLElement>(".stage");
    if (room) watch.observe(room);
    const row = room?.querySelector<HTMLElement>(".room-pill");
    if (row) watch.observe(row);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      watch.disconnect();
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
