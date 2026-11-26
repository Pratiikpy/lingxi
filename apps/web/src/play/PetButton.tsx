/**
 * P5: the pet for the keyboard and for a screen reader. The pet is drawn on the room's canvas, which neither can reach,
 * so a real button stands where the pet is drawn (placed by the room's own rule, floor.ts roomOrigin): Tab reaches it,
 * Enter or Space pats the pet as a tap does, and its description is the pet in words (petSpoken.ts). It takes no
 * pointer events, so a tap still lands on the canvas, on the pet, its visitors and the floor, as before; its ring shows
 * only when the keyboard is on it. A polite live region beside it reads out a change in what the pet is doing or needs,
 * at most once every few seconds, so a screen reader is told without being talked over.
 */
import { useEffect, useRef, useState } from "react";
import { type Pet, stageOf } from "@lingxi/game";
import { HALF, PET_FEET, PET_HOME, roomOrigin, stripRoomOf } from "../scene/floor";
import { useLang, useT, type Key } from "../i18n";
import { now } from "../game/gameClock";
import { takeHatched } from "./afterHatch";
import { petSpoken } from "./petSpoken";

/** The quietest a change is read out: one announcement in this many milliseconds at most. */
export const SPEAK_EVERY_MS = 8_000;
/** How long after the room is drawn the pet takes the focus following a hatching. */
export const FOCUS_AFTER_HATCH_MS = 400;
/** How tall the button stands above the pet's feet, in room pixels: a grown pet's height. */
const PET_TALL = 40;

type DrawnStage = keyof typeof HALF;

export function PetButton({ pet, stage, onPat }: { pet: Pet; stage: DrawnStage; onPat: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const zh = lang === "zh";
  const stageWord = t(`stage.${stageOf(pet, now())}` as Key);
  const words = petSpoken(pet, stageWord, zh ? "zh" : "en");

  // just hatched: the focus comes to the pet, so a screen reader's next words are the pet itself (R8, afterHatch.ts)
  // a moment after the pet's place in the room is known: a focus moved in the same breath as the button was made went
  // unannounced (NVDA said nothing after Hatch, though the focus was on the pet)
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const id = setTimeout(() => {
      if (takeHatched()) button.current?.focus({ preventScroll: true });
    }, FOCUS_AFTER_HATCH_MS);
    return () => clearTimeout(id);
  }, [placed]);

  // where the pet stands in the room as drawn, kept as the room's box changes size
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const o = roomOrigin(el.clientWidth, el.clientHeight, stripRoomOf(el));
      const half = HALF[stage] * o.scale;
      const next = {
        left: o.x + PET_HOME * o.scale - half - 6,
        top: o.y + (PET_FEET - PET_TALL) * o.scale,
        width: 2 * half + 12,
        height: PET_TALL * o.scale + 6,
      };
      // the room's children change often (a notice, a card); the pet's place only now and then
      setPlace((was) =>
        was && was.left === next.left && was.top === next.top && was.width === next.width && was.height === next.height
          ? was
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // the strip over the room's foot comes and goes with what the room holds, as the room's own drawing follows it
    const strips = new MutationObserver(measure);
    if (el.parentElement) strips.observe(el.parentElement, { childList: true });
    return () => {
      ro.disconnect();
      strips.disconnect();
    };
  }, [stage]);

  // a change read out politely, and never more often than SPEAK_EVERY_MS
  const [spoken, setSpoken] = useState("");
  const lastAt = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, lastAt.current + SPEAK_EVERY_MS - Date.now());
    const id = setTimeout(() => {
      lastAt.current = Date.now();
      setSpoken(words);
    }, wait);
    return () => clearTimeout(id);
  }, [words]);

  return (
    <div ref={box} className="pet-button-box">
      <button
        ref={button}
        type="button"
        className="pet-button"
        style={place ?? undefined}
        aria-label={zh ? `摸摸${pet.name}` : `Pat ${pet.name}`}
        aria-describedby="pet-words"
        onClick={onPat}
      >
        <span id="pet-words" className="sr-only">
          {words}
        </span>
      </button>
      <span className="sr-only" role="status">
        {spoken}
      </span>
    </div>
  );
}
