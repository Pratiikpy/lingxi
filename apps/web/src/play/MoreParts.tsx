/**
 * R72: the Pet sheet's "Shops, friends and more" in named parts. It held some twenty panels one after another (about
 * sixteen screens on a phone) with nothing to say where anything was. The parts are listed at its top; a tap on one
 * jumps the sheet there and puts the focus on its heading, and each part's heading has a way back to the list. Every
 * panel is still drawn, in its part, so nothing a player had is further than a tap and a glance.
 */
import { Fragment, type ReactNode, useRef } from "react";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { bringIntoView } from "./bringIntoView";

export type PartId = "style" | "shops" | "friends" | "neighbours" | "badges" | "chain" | "game";

const TITLE: Record<PartId, { en: string; zh: string }> = {
  style: { en: "Style", zh: "衣橱和造型" },
  shops: { en: "Shops", zh: "商店" },
  friends: { en: "Friends", zh: "朋友" },
  neighbours: { en: "Neighbours and visitors", zh: "邻居和来客" },
  badges: { en: "Badges", zh: "徽章" },
  chain: { en: "On X Layer", zh: "链上" },
  game: { en: "Your game", zh: "你的游戏" },
};

export interface MorePart {
  id: PartId;
  /** its panels, in order; a divider is drawn between each two */
  children: ReactNode[];
}

export function MoreParts({ parts }: { parts: readonly MorePart[] }) {
  const lang = useLang((s) => s.lang) === "zh" ? "zh" : "en";
  const index = useRef<HTMLElement>(null);
  const jumps = useRef<Partial<Record<PartId, HTMLButtonElement | null>>>({});
  const heads = useRef<Partial<Record<PartId, HTMLHeadingElement | null>>>({});
  const go = (to: HTMLElement | null | undefined) => {
    play("tap");
    if (to) bringIntoView(to, { start: true, jump: true });
  };
  // the way back shows the whole list, with the focus on the part the player came from
  const back = (id: PartId) => {
    play("tap");
    const from = jumps.current[id];
    if (index.current && from) bringIntoView(index.current, { start: true, jump: true, focus: from });
  };
  return (
    <div className="me-parts">
      <nav ref={index} className="me-parts-index" aria-label={lang === "zh" ? "跳到" : "Jump to"}>
        {parts.map((p) => (
          <button
            key={p.id}
            ref={(el) => void (jumps.current[p.id] = el)}
            type="button"
            className="me-parts-jump"
            onClick={() => go(heads.current[p.id])}
          >
            {TITLE[p.id][lang]}
          </button>
        ))}
      </nav>
      {parts.map((p) => (
        <section key={p.id} id={`me-part-${p.id}`} className="me-part" aria-labelledby={`me-part-${p.id}-h`}>
          <div className="me-part-h">
            <h3 id={`me-part-${p.id}-h`} ref={(el) => void (heads.current[p.id] = el)} tabIndex={-1}>
              {TITLE[p.id][lang]}
            </h3>
            <button type="button" className="btn small-btn me-part-back" onClick={() => back(p.id)}>
              {lang === "zh" ? "回到目录" : "Back to the list"}
            </button>
          </div>
          {p.children.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <hr className="divider" />}
              {c}
            </Fragment>
          ))}
        </section>
      ))}
    </div>
  );
}
