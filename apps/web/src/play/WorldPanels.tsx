/** The map, the bag (food, drinks, materials, workbench, shop) and the quest list. */

import { CuteState } from "./CuteState";
import { useMemo, useState } from "react";
import { stageOf } from "@lingxi/game";
import { HOME, ITEM, QUESTS, RECIPES, ROOMS, has, neighbours, questState } from "@lingxi/world";
import { useLang, useT, type Key } from "../i18n";
import { useChain } from "../game/chain";
import { useGame } from "../game/store";
import { type WorldNotice, useWorld } from "../game/world";
import "./world.css";
import { GardenPanel } from "./Garden";

export function itemList(items: Array<{ item: number; n: number }> | undefined, lang: "en" | "zh"): string {
  return (items ?? []).map((x) => `${ITEM[x.item]?.name[lang] ?? "?"}${x.n > 1 ? ` ×${x.n}` : ""}`).join(lang === "zh" ? "、" : ", ");
}

export function noticeText(nt: WorldNotice, t: ReturnType<typeof useT>, lang: "en" | "zh"): string | null {
  if (nt.kind === "moved") return nt.coins ? t("world.firstVisit", { n: nt.coins }) : null;
  if (nt.kind === "found") return t("world.found", { items: itemList(nt.items, lang) });
  if (nt.kind === "bought") return t("world.bought", { items: itemList(nt.items, lang) });
  if (nt.kind === "made") return t("world.made", { items: itemList(nt.items, lang) });
  if (nt.kind === "opened") return t("world.opened", { items: itemList(nt.items, lang) });
  if (nt.kind === "planted") return t("world.planted");
  if (nt.kind === "harvested") return t("world.harvested", { items: itemList(nt.items, lang) });
  if (nt.kind === "compost") return t("world.compost");
  if (nt.kind === "claimed") return t("world.claimed", { coins: nt.coins ?? 0, items: nt.items?.length ? (lang === "zh" ? `，${itemList(nt.items, lang)}` : `, ${itemList(nt.items, lang)}`) : "" });
  const k = `world.fail.${nt.reason}` as Key;
  return ["tired", "asleep", "already", "nothingHere", "coins", "missing", "notNear", "full", "owned", "notHere", "noSeed", "noCompost", "notRipe", "taken"].includes(nt.reason ?? "") ? t(k) : t("world.fail.other");
}

export function MapPanel({ onGone }: { onGone: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { world, move } = useWorld();
  const here = ROOMS[world.room]!;
  const [z, setZ] = useState(here.z);
  const near = useMemo(() => new Set(neighbours(world.room)), [world.room]);
  const levels = useMemo(() => [...new Set(Object.values(ROOMS).filter((r) => world.visited.includes(r.index) || near.has(r.index)).map((r) => r.z))].sort(), [world.visited, near]);
  const rooms = Object.values(ROOMS).filter((r) => r.z === z);
  const xs = rooms.map((r) => r.x);
  const ys = rooms.map((r) => r.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1;
  const rows = Math.max(...ys) - minY + 1;
  return (
    <div className="map">
      {levels.length > 1 && (
        <div className="map-levels" role="tablist">
          {levels.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={l === z} className={`val${l === z ? " on" : ""}`} onClick={() => setZ(l)}>
              {t(`map.level.${l}` as Key)}
            </button>
          ))}
        </div>
      )}
      <div className="map-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {rooms.map((r) => {
          const visited = world.visited.includes(r.index);
          const isHere = r.index === world.room;
          const canGo = near.has(r.index);
          const label = visited || canGo ? r.name[lang] : t("map.unknown");
          return (
            <button
              key={r.index}
              type="button"
              className={`tile${isHere ? " here" : ""}${canGo ? " near" : ""}${visited || canGo ? "" : " fog"}`}
              style={{ gridColumn: r.x - minX + 1, gridRow: r.y - minY + 1 }}
              disabled={!canGo}
              aria-label={isHere ? `${label} · ${t("map.here")}` : label}
              onClick={() => {
                if (move(r.index)) onGone();
              }}
            >
              {visited || canGo ? <img className="pixel" src={r.bgs.day} alt="" loading="lazy" /> : <span>?</span>}
              {isHere && <i className="dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="map-here">
        <b>{here.name[lang]}</b>
        <span>{here.desc[lang]}</span>
      </div>
      <p className="small">{t("map.cost")}</p>
    </div>
  );
}

export function BagPanel({ onFed }: { onFed: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { world, use, craft, buy, openBox } = useWorld();
  const room = ROOMS[world.room]!;
  const entries = Object.entries(world.bag)
    .map(([k, v]) => ({ item: ITEM[Number(k)], n: v }))
    .filter((e): e is { item: NonNullable<typeof e.item>; n: number } => !!e.item);
  const food = entries.filter((e) => e.item.kind === "food");
  const drinks = entries.filter((e) => e.item.kind === "drink" || e.item.kind === "box" || (e.item.kind === "treasure" && e.item.use));
  const stuff = entries.filter((e) => !food.includes(e) && !drinks.includes(e));
  const makeable = RECIPES.filter((r) => r.ins.every((x) => has(world, x.item, x.amount)));
  const Row = ({ e, action, onAct }: { e: (typeof entries)[number]; action?: string; onAct?: () => void }) => (
    <li className="bag-item">
      <img className="pixel" src={e.item.art} alt="" width={40} height={40} />
      <div className="bag-text">
        <b>
          {e.item.name[lang]} <em>×{e.n}</em>
        </b>
        <span>{e.item.desc[lang]}</span>
      </div>
      {action && (
        <button type="button" className="btn" onClick={onAct}>
          {action}
        </button>
      )}
    </li>
  );
  return (
    <div className="bag">
      <p className="coins">{t("bag.coins", { n: world.coins })}</p>
      <GardenPanel />
      {room.shop.length > 0 && (
        <section>
          <p className="label">{t("bag.shop")}</p>
          <ul className="bag-list">
            {room.shop.map((i) => {
              const it = ITEM[i]!;
              return (
                <li key={i} className="bag-item">
                  <img className="pixel" src={it.art} alt="" width={40} height={40} />
                  <div className="bag-text">
                    <b>{it.name[lang]}</b>
                    <span>{it.desc[lang]}</span>
                  </div>
                  <button type="button" className="btn primary" disabled={world.coins < (it.price ?? 0)} onClick={() => buy(i)}>
                    {t("bag.buy")} · {it.price}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section>
        <p className="label">{t("bag.food")}</p>
        {food.length ? (
          <ul className="bag-list">
            {food.map((e) => (
              <Row key={e.item.index} e={e} action={t("bag.feed")} onAct={() => (use(e.item.index), onFed())} />
            ))}
          </ul>
        ) : (
          <CuteState who={{ cat: "groom" }} text={t("bag.empty")} />
        )}
      </section>
      {drinks.length > 0 && (
        <section>
          <p className="label">{t("bag.drinks")}</p>
          <ul className="bag-list">
            {drinks.map((e) => (
              <Row key={e.item.index} e={e} action={e.item.kind === "box" ? t("bag.open") : t("bag.use")} onAct={() => (e.item.kind === "box" ? openBox() : (use(e.item.index), onFed()))} />
            ))}
          </ul>
        </section>
      )}
      {stuff.length > 0 && (
        <section>
          <p className="label">{t("bag.materials")}</p>
          <ul className="bag-grid">
            {stuff.map((e) => (
              <li key={e.item.index} title={e.item.desc[lang]}>
                <img className="pixel" src={e.item.art} alt="" width={40} height={40} />
                <span>
                  {e.item.name[lang]} ×{e.n}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <p className="label">{t("bag.workbench")}</p>
        {makeable.length ? (
          <ul className="bag-list">
            {makeable.map((r) => (
              <li key={r.index} className="bag-item">
                <img className="pixel" src={ITEM[r.out]!.art} alt="" width={40} height={40} />
                <div className="bag-text">
                  <b>{r.name[lang]}</b>
                  <span>{r.ins.map((x) => `${ITEM[x.item]!.name[lang]} ×${x.amount}`).join(" + ")}</span>
                </div>
                <button type="button" className="btn primary" onClick={() => craft(r.index)}>
                  {t("bag.make")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small">{lang === "zh" ? "收集更多材料，就能在这里做东西。" : "Collect more things on your walks to make something here."}</p>
        )}
      </section>
    </div>
  );
}

export function QuestPanel() {
  const t = useT();
  const { lang } = useLang();
  const { world, claim } = useWorld();
  const pet = useGame((s) => s.pet);
  const onChain = useChain((s) => s.record !== null);
  if (!pet) return null;
  const view = { world, counts: pet.counts, stage: stageOf(pet, Date.now()), onChain };
  const shown = QUESTS.map((q) => ({ q, st: questState(q, view, world.claimed) })).filter((x) => x.st !== "locked");
  shown.sort((a, b) => ["ready", "active", "claimed"].indexOf(a.st) - ["ready", "active", "claimed"].indexOf(b.st));
  return (
    <ul className="quests">
      {shown.map(({ q, st }) => {
        const p = Math.min(q.need, q.progress(view));
        return (
          <li key={q.id} className={`quest ${st}`}>
            <div className="bag-text">
              <b>{q.title[lang]}</b>
              <span>
                {q.goal[lang]} · {p}/{q.need}
              </span>
              <div className="bar" aria-hidden="true">
                <b style={{ transform: `scaleX(${p / q.need})`, background: "var(--sky)" }} />
              </div>
            </div>
            {st === "ready" ? (
              <button type="button" className="btn primary" onClick={() => claim(q.id)}>
                {t("quest.claim")}
              </button>
            ) : (
              <span className="quest-state">{st === "claimed" ? t("quest.done") : `+${q.reward.coins}`}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const HOME_ROOM = HOME;
