/**
 * The collection (D5): what the first screen's "Collection" count is made of, in one sheet. The visitor album with its
 * hints and keepsakes, the badges, and every home piece, owned or not yet and where it comes from.
 */

import { BADGES, VISITORS, tierOf } from "@lingxi/game";
import { DECOR, decorOf } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { useBadges } from "../game/badges";
import { AlbumPanel, useAlbum } from "./Album";
import { BadgeShelf } from "./Badges";
import { DecorIcon } from "./DecorBar";

const STAGE: Record<string, [string, string]> = { child: ["child", "幼年"], teen: ["teen", "少年"], adult: ["adult", "成年"], elder: ["elder", "老年"] };

/** Every home piece, owned first, each saying where it comes from. */
function HomePieces() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const world = useWorld((s) => s.world);
  const owned = new Set(decorOf(world).owned);
  const where = (d: (typeof DECOR)[number]): string =>
    d.commission
      ? zh
        ? `建设者定做 · ${STAGE[d.commission.stage]![1]}起`
        : `Builder's commission · from ${STAGE[d.commission.stage]![0]}`
      : d.gift
        ? zh
          ? "纪念品：故事或访客留下的"
          : "A keepsake: from a story or a visitor"
        : zh
          ? `布置里买 · ${d.price} 金币`
          : `Bought in Decorate · ${d.price} coins`;
  const list = [...DECOR].sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)));
  return (
    <section className="collection-home" aria-label={zh ? "家具" : "Home pieces"}>
      <div className="badges-head">
        <p className="label">{zh ? "家具" : "Home pieces"}</p>
        <span className="small">{zh ? `已有 ${owned.size} / ${DECOR.length}` : `${owned.size} of ${DECOR.length}`}</span>
      </div>
      <ul className="collection-pieces">
        {list.map((d) => (
          <li key={d.id} className={owned.has(d.id) ? "owned" : "not-yet"}>
            <DecorIcon rows={d.rows} colors={d.colors} />
            <b>{owned.has(d.id) ? d.name[zh ? "zh" : "en"] : "???"}</b>
            <span className="small">{where(d)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CollectionPanel() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const album = useAlbum((s) => s.album);
  const ledger = useBadges((s) => s.ledger);
  const owned = useWorld((s) => decorOf(s.world).owned.length);
  const met = VISITORS.filter((v) => album[v.id]).length;
  const badges = BADGES.filter((b) => tierOf(b, ledger) > 0).length;
  const have = met + badges + owned;
  const all = VISITORS.length + BADGES.length + DECOR.length;
  return (
    <div className="collection">
      <p className="small collection-sum">
        {zh ? `一共收集了 ${have} / ${all}：访客 ${met}、徽章 ${badges}、家具 ${owned}。` : `${have} of ${all} collected: ${met} visitors, ${badges} badges, ${owned} home pieces.`}
      </p>
      <AlbumPanel />
      <hr className="divider" />
      <BadgeShelf />
      <hr className="divider" />
      <HomePieces />
    </div>
  );
}
