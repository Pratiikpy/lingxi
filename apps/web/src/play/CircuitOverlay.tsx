/**
 * The pet's circuit over the room. The thinking strip stays at the room's foot while the circuit is open, and on a
 * phone it runs to two lines, so the overlay keeps clear of the strip's real height, measured, rather than a guess:
 * the circuit's caption and its download buttons always sit above the strip (row B5).
 */

import { useLayoutEffect, useRef } from "react";
import type { Pet } from "@lingxi/game";
import { BrainView } from "./BrainView";

/** Space between the circuit's caption and the strip. */
const GAP = 10;

export function CircuitOverlay({ pet, reduceMotion }: { pet: Pet; reduceMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const strip = el?.parentElement?.querySelector<HTMLElement>(":scope > .think");
    if (!el) return;
    const place = () => {
      // from the strip's top edge to the room's foot (both measured in the room); a strip moved under the room (a short
      // phone) is not over it, so only the gap is kept
      const over = strip && getComputedStyle(strip).position === "absolute" ? Math.max(0, el.offsetHeight - strip.offsetTop) : 0;
      el.style.setProperty("--strip-h", `${over + GAP}px`);
    };
    place();
    // the room and the strip both change size (a turned phone, a strip that names where its rule came from)
    const ro = new ResizeObserver(place);
    ro.observe(el);
    if (strip) ro.observe(strip);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="circuit-overlay" ref={ref}>
      <BrainView pet={pet} reduceMotion={reduceMotion} />
    </div>
  );
}
