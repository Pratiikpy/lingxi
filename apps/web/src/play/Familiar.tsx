/**
 * How well the pet knows the room it is in (plan 4.5; row B5). A labelled chip beside "Look around": the bar and its
 * count in words, so a phone player reads it without hovering, and one tap says what it is for.
 */

import { useEffect, useState } from "react";
import { useLang } from "../i18n";
import { play } from "../game/sound";

/** How long the explanation stays up after a tap. */
const WHY_MS = 6000;

export function Familiar({ known, size }: { known: number; size: number }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), WHY_MS);
    return () => clearTimeout(t);
  }, [open]);
  const n = Math.min(known, size);
  const full = n >= size;
  return (
    <span className="familiar-wrap">
      <button
        type="button"
        className={`familiar${full ? " is-full" : ""}`}
        aria-expanded={open}
        aria-label={zh ? `对这里的熟悉程度：${n}/${size}` : `How well your pet knows this place: ${n} of ${size}`}
        onClick={() => (play("tap"), setOpen((o) => !o))}
      >
        <span
          className="familiar-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={size}
          aria-valuenow={n}
          aria-hidden="true"
        >
          <i style={{ width: `${Math.round((100 * n) / size)}%` }} />
        </span>
        <span>{zh ? `熟悉 ${n}/${size}` : `Known ${n}/${size}`}</span>
      </button>
      {open && (
        <span className="familiar-why" role="status">
          {full
            ? zh
              ? "它很熟悉这里了：再找找，会发现藏着的东西。"
              : "It knows this place well now: look around to find what is hidden here."
            : zh
              ? "常来这里找找。熟悉了，就会发现藏着的东西。"
              : "Look around here often. Once your pet knows a place, it finds what is hidden there."}
        </span>
      )}
    </span>
  );
}
