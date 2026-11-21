/**
 * H5: the Pet tab opens on the pet. Its shops, friends and extras sit behind this one entry, mounted only once it is
 * opened (so the tab is quick to open too), and it stays open on this device once a player has opened it.
 */

import { useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { play } from "../game/sound";

const KEY = "lingxi.meMore.v1";

function wasOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function MoreBehind({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(wasOpen);
  const toggle = () => {
    play("tap");
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // remembered for this visit only
    }
  };
  return (
    <section className="me-more">
      <button type="button" className="me-more-open" aria-expanded={open} onClick={toggle}>
        <span>
          <b>{t("me.more")}</b>
          <small>{t("me.moreHint")}</small>
        </span>
        <i className="me-more-mark" aria-hidden="true">
          {open ? "−" : "+"}
        </i>
      </button>
      {open && <div className="me-more-body">{children}</div>}
    </section>
  );
}
