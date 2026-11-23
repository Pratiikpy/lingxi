/** The map, the bag (food, drinks, materials, workbench, shop) and the quest list. */

import { BUILDER_PET, type BuilderId, builderIn } from "@lingxi/game";
import { CuteState } from "./CuteState";
import { play } from "../game/sound";
import { FRESH_START_TEA, useSkillsUi } from "./Skills";
import { useMemo, useState } from "react";
import { stageOf } from "@lingxi/game";
import { BOX_TABLES, CORNER_SHOP, DECOR_BY_ID, HOME, ITEM, MAKE_RECIPES, PIECE_PRICES, QUESTS, RECIPES, ROOMS, STORY, type Buff, type Recipe, craftBlocker, has, knownTravelRecipes, neighbours, ownedPieces, questState, usedOf, MARKET_ROOM, happeningAt, villageEvening, marketPrice, happeningUsed } from "@lingxi/world";
import { WEARABLE } from "@lingxi/art";
import { useLang, useT, type Key } from "../i18n";
import { useChain } from "../game/chain";
import { useGame } from "../game/store";
import { type WorldNotice, useWorld } from "../game/world";
import { giverRoom, useQuestStatuses } from "../game/quests";
import "./world.css";
import { GardenPanel } from "./Garden";
import { now } from "../game/gameClock";

export function itemList(items: Array<{ item: number; n: number }> | undefined, lang: "en" | "zh"): string {
  return (items ?? []).map((x) => `${ITEM[x.item]?.name[lang] ?? "?"}${x.n > 1 ? ` ×${x.n}` : ""}`).join(lang === "zh" ? "、" : ", ");
}

export function noticeText(nt: WorldNotice, t: ReturnType<typeof useT>, lang: "en" | "zh"): string | null {
  if (nt.kind === "moved") {
    // Wanderer and Rich Finds (G6): the first entry today into this room picked something up
    const picked = nt.items?.length ? (lang === "zh" ? `进门时捡到了${itemList(nt.items, lang)}。` : `Picked up ${itemList(nt.items, lang)} on the way in.`) : "";
    const first = nt.coins ? t("world.firstVisit", { n: nt.coins }) : "";
    return [first, picked].filter(Boolean).join(lang === "zh" ? "" : " ") || null;
  }
  if (nt.kind === "found" && nt.secret)
    return lang === "zh" ? `找到了 ${itemList(nt.items, lang)}。这里越来越熟悉了，还发现了一样藏着的东西！` : `Found ${itemList(nt.items, lang)}. This place knows you now, and showed you something hidden!`;
  if (nt.kind === "found" && nt.text === "lucky")
    return lang === "zh" ? `找到了 ${itemList(nt.items, lang)}。今天是这里的幸运日，多找到了一样！` : `Found ${itemList(nt.items, lang)}. It's this room's lucky day: one more find!`;
  if (nt.kind === "found") return t("world.found", { items: itemList(nt.items, lang) });
  if (nt.kind === "readied") return lang === "zh" ? `${itemList(nt.items, lang)}准备好了，下次会用上。` : `${itemList(nt.items, lang)} is ready for next time.`;
  if (nt.kind === "made" && nt.xp) return lang === "zh" ? `做好了 ${itemList(nt.items, lang)}。经验 +${nt.xp}。` : `Made ${itemList(nt.items, lang)}. +${nt.xp} experience.`;
  if (nt.kind === "bought") return t("world.bought", { items: itemList(nt.items, lang) });
  if (nt.kind === "made") return t("world.made", { items: itemList(nt.items, lang) });
  if (nt.kind === "opened") return t("world.opened", { items: itemList(nt.items, lang) });
  if (nt.kind === "planted") return t("world.planted");
  if (nt.kind === "harvested") return t("world.harvested", { items: itemList(nt.items, lang) });
  if (nt.kind === "compost") return t("world.compost");
  if (nt.kind === "sewn") return lang === "zh" ? `新衣服：${WEARABLE[nt.text ?? ""]?.name.zh ?? ""}。去宠物页穿上吧。` : `New outfit: ${WEARABLE[nt.text ?? ""]?.name.en ?? ""}. Put it on from the pet page.`;
  if (nt.kind === "built") return lang === "zh" ? `做好了${DECOR_BY_ID[nt.text ?? ""]?.name.zh ?? ""}，可以摆在家里了。` : `Built a ${DECOR_BY_ID[nt.text ?? ""]?.name.en.toLowerCase() ?? ""} for the home.`;
  if (nt.kind === "claimed") return t("world.claimed", { coins: nt.coins ?? 0, items: nt.items?.length ? (lang === "zh" ? `，${itemList(nt.items, lang)}` : `, ${itemList(nt.items, lang)}`) : "" });
  const more: Record<string, [string, string]> = {
    tool: ["You need the right tool for that. Praline's Corner Shop sells them.", "需要合适的工具。糖霜的街角小店有卖。"],
    room: ["That can only be made in one special place.", "这个只能在一个特别的地方做。"],
    limit: ["Your pet has had as many of those as it ever can.", "这个宠物已经用到上限了。"],
    notABox: ["That doesn't open.", "这个打不开。"],
    none: ["You don't have one of those.", "你没有这个。"],
    stage: ["Your pet needs to grow up a little more for that.", "宠物还要再长大一些才行。"],
    allDug: ["Every plot is already dug.", "所有地块都已经开出来了。"],
  };
  const m = more[nt.reason ?? ""];
  if (m) return lang === "zh" ? m[1] : m[0];
  const k = `world.fail.${nt.reason}` as Key;
  return ["tired", "asleep", "already", "nothingHere", "coins", "missing", "notNear", "full", "owned", "notHere", "noSeed", "noCompost", "notRipe", "taken", "walking", "travelling", "notBack", "notSold", "notOwned", "wrongSlot"].includes(nt.reason ?? "") ? t(k) : t("world.fail.other");
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
  // rooms where someone has a quest to give ("!") or to take back ("✓")
  const st = useQuestStatuses();
  const marks = useMemo(() => {
    const out: Record<number, "!" | "✓"> = {};
    for (const q of STORY) {
      const s2 = st[q.id];
      if (s2 !== "available" && s2 !== "ready") continue;
      const room = q.giver.startsWith("lane:") ? BUILDER_PET[q.giver.slice(5) as BuilderId]?.room : giverRoom[q.giver];
      if (room === undefined) continue;
      if (s2 === "ready" || !out[room]) out[room] = s2 === "ready" ? "✓" : "!";
    }
    return out;
  }, [st]);
  return (
    <div className="map">
      {levels.length > 1 && (
        <div className="map-levels" role="tablist">
          {levels.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={l === z} className={`val${l === z ? " on" : ""}`} onClick={() => setZ(l)}>
              {t(`map.level.${l}` as Key)}
              {/* a quest waits on this level: say so on its tab, so a mark on another floor is never missed */}
              {Object.entries(marks).some(([room]) => ROOMS[Number(room)]?.z === l && (world.visited.includes(Number(room)) || near.has(Number(room)))) && (
                <i className="map-quest inline" aria-label={lang === "zh" ? "这层有任务" : "a quest on this level"}>
                  !
                </i>
              )}
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
              {builderIn(r.index) && (visited || canGo) && <i className="lane-mark" title={builderIn(r.index)!.name[lang]} aria-hidden="true" />}
              {marks[r.index] && (visited || canGo) && (
                <i className={`map-quest${marks[r.index] === "✓" ? " ready" : ""}`} aria-label={marks[r.index] === "✓" ? (lang === "zh" ? "有任务可以交" : "a quest to hand in") : lang === "zh" ? "有新任务" : "a new quest"}>
                  {marks[r.index]}
                </i>
              )}
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
  const { world, use, craft, buy, openBox, make, buyPiece } = useWorld();
  const owned = ownedPieces(world);
  const room = ROOMS[world.room]!;
  const entries = Object.entries(world.bag)
    .map(([k, v]) => ({ item: ITEM[Number(k)], n: v }))
    .filter((e): e is { item: NonNullable<typeof e.item>; n: number } => !!e.item);
  const food = entries.filter((e) => e.item.kind === "food");
  const drinks = entries.filter((e) => e.item.kind === "drink" || (e.item.kind === "box" && BOX_TABLES[e.item.index]) || (e.item.kind === "treasure" && (e.item.use || e.item.buff)));
  const tools = entries.filter((e) => e.item.kind === "tool");
  const stuff = entries.filter((e) => !food.includes(e) && !drinks.includes(e) && !tools.includes(e));
  // every recipe whose ingredients are in the bag, even if a tool, the place or the pet's energy still stands in the way
  const makeable = [...RECIPES, ...knownTravelRecipes(world)].filter((r) => r.ins.every((x) => has(world, x.item, x.amount)));
  const energy = useGame((s) => (s.pet ? Math.floor(s.pet.meters.energy / 60) : 0));
  const blockText = (r: Recipe): string | null => {
    const b = craftBlocker(world, r, energy);
    if (b === "tool") return lang === "zh" ? `需要${ITEM[r.tool!]!.name.zh}` : `Needs a ${ITEM[r.tool!]!.name.en}`;
    if (b === "room") return lang === "zh" ? `只能在${ROOMS[r.room!]?.name.zh ?? "那里"}做` : `Only at the ${ROOMS[r.room!]?.name.en ?? "right place"}`;
    if (b === "tired") return lang === "zh" ? "宠物太累了" : "Your pet is too tired";
    return null;
  };
  const Row = ({ e, action, onAct }: { e: (typeof entries)[number]; action?: string; onAct?: () => void }) => (
    <li className="bag-item">
      <img className="pixel" src={e.item.art} alt="" width={40} height={40} />
      <div className="bag-text">
        <b>
          {e.item.name[lang]} <em>×{e.n}</em>
        </b>
        <span>{e.item.desc[lang]}</span>
        {e.item.limit !== undefined && (
          <span className="small">{lang === "zh" ? `已用 ${usedOf(world, e.item.index)}/${e.item.limit}` : `Used ${usedOf(world, e.item.index)} of ${e.item.limit}`}</span>
        )}
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
      <MarketStall />
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
              e.item.index === FRESH_START_TEA ? (
                // the Fresh Start Tea returns skill points: it opens the skills screen to confirm (plan 4.4)
                <Row key={e.item.index} e={e} action={lang === "zh" ? "重新选择技能" : "Choose skills again"} onAct={() => (play("tap"), useSkillsUi.getState().show({ respec: true }))} />
              ) : (
                <Row key={e.item.index} e={e} action={e.item.kind === "box" ? t("bag.open") : e.item.buff && !e.item.use ? (lang === "zh" ? "备好" : "Ready it") : t("bag.use")} onAct={() => (e.item.kind === "box" ? openBox(e.item.index) : (use(e.item.index), onFed()))} />
              )
            ))}
          </ul>
        </section>
      )}
      <WaitingBonuses buffs={world.buffs} lang={lang} />
      {tools.length > 0 && (
        <section>
          <p className="label">{lang === "zh" ? "工具" : "Tools"}</p>
          <ul className="bag-grid">
            {tools.map((e) => (
              <li key={e.item.index} title={e.item.desc[lang]}>
                <img className="pixel" src={e.item.art} alt="" width={40} height={40} />
                <span>{e.item.name[lang]}</span>
              </li>
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
      {world.room === CORNER_SHOP && (
        <section>
          <p className="label">{lang === "zh" ? "衣服" : "Outfits"}</p>
          <ul className="bag-list">
            {Object.entries(PIECE_PRICES).map(([id, price]) => (
              <li key={id} className="bag-item no-art">
                <div className="bag-text">
                  <b>{WEARABLE[id]!.name[lang]}</b>
                  <span>{lang === "zh" ? "只是好看，不影响玩法。" : "Looks only; it never changes how your pet plays."}</span>
                </div>
                <button type="button" className="btn primary" disabled={owned.includes(id) || world.coins < price} onClick={() => buyPiece(id)}>
                  {owned.includes(id) ? (lang === "zh" ? "已拥有" : "Owned") : `${t("bag.buy")} · ${price}`}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <p className="label">{lang === "zh" ? "缝衣服 · 做家具" : "Sew and build"}</p>
        <ul className="bag-list">
          {MAKE_RECIPES.map((r) => {
            const done = r.kind === "outfit" ? owned.includes(r.id) : (world.decor?.owned ?? []).includes(r.id);
            const can = r.ins.every((x) => has(world, x.item, x.amount));
            const name = r.kind === "outfit" ? WEARABLE[r.id]!.name[lang] : DECOR_BY_ID[r.id]!.name[lang];
            return (
              <li key={`${r.kind}:${r.id}`} className={`bag-item no-art${can || done ? "" : " is-dim"}`}>
                <div className="bag-text">
                  <b>
                    {name} <em>{r.kind === "outfit" ? (lang === "zh" ? "衣服" : "outfit") : lang === "zh" ? "家具" : "furniture"}</em>
                  </b>
                  <span>{r.ins.map((x) => `${ITEM[x.item]!.name[lang]} ×${x.amount} (${world.bag[x.item] ?? 0})`).join(" + ")}</span>
                </div>
                <button type="button" className="btn primary" disabled={done || !can} onClick={() => make(r.kind, r.id)}>
                  {done ? (lang === "zh" ? "已有" : "Have it") : r.kind === "outfit" ? (lang === "zh" ? "缝" : "Sew") : lang === "zh" ? "做" : "Build"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <p className="label">{t("bag.workbench")}</p>
        {makeable.length ? (
          <ul className="bag-list">
            {makeable.map((r) => {
              const blocked = blockText(r);
              return (
                <li key={r.index} className={`bag-item${blocked ? " is-dim" : ""}`}>
                  <img className="pixel" src={ITEM[r.out]!.art} alt="" width={40} height={40} />
                  <div className="bag-text">
                    <b>
                      {r.name[lang]}
                      {r.outAmount > 1 && <em> ×{r.outAmount}</em>}
                    </b>
                    <span>{r.ins.map((x) => `${ITEM[x.item]!.name[lang]} ×${x.amount}`).join(" + ")}</span>
                    <span className="small craft-cost">
                      {[
                        r.tool !== undefined ? (lang === "zh" ? `工具：${ITEM[r.tool]!.name.zh}` : `Tool: ${ITEM[r.tool]!.name.en}`) : null,
                        r.energy ? (lang === "zh" ? `精神 −${r.energy}` : `Energy −${r.energy}`) : null,
                        r.xp ? (lang === "zh" ? `经验 +${r.xp}` : `+${r.xp} XP`) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {blocked && <span className="small craft-block">{blocked}</span>}
                  </div>
                  <button type="button" className="btn primary" disabled={!!blocked} onClick={() => craft(r.index)}>
                    {t("bag.make")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="small">{lang === "zh" ? "收集更多材料，就能在这里做东西。" : "Collect more things on your walks to make something here."}</p>
        )}
      </section>
    </div>
  );
}

/** Bonuses waiting for the next look around or spar, so a readied jewel is never forgotten. */
function WaitingBonuses({ buffs, lang }: { buffs: Buff | undefined; lang: "en" | "zh" }) {
  const b = buffs ?? {};
  const lines = [
    b.forageExtra ? (lang === "zh" ? `下次四处找找多找到 ${b.forageExtra} 样` : `${b.forageExtra} more find${b.forageExtra > 1 ? "s" : ""} next time you look around`) : null,
    b.sparPower ? (lang === "zh" ? `下一场切磋力量 +${b.sparPower}` : `+${b.sparPower} power in the next spar`) : null,
    b.sparHp ? (lang === "zh" ? `下一场切磋体力 +${b.sparHp}` : `+${b.sparHp} health in the next spar`) : null,
    b.sparLossCoins ? (lang === "zh" ? `下一场切磋输了也有 ${b.sparLossCoins} 金币` : `${b.sparLossCoins} coins even if the next spar is lost`) : null,
  ].filter((x): x is string => !!x);
  if (!lines.length) return null;
  return (
    <section className="bonuses" aria-label={lang === "zh" ? "备好的加成" : "Bonuses ready"}>
      <p className="label">{lang === "zh" ? "备好的加成" : "Ready for next time"}</p>
      <ul>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

export function QuestPanel() {
  const t = useT();
  const { lang } = useLang();
  const { world, claim } = useWorld();
  const pet = useGame((s) => s.pet);
  const onChain = useChain((s) => s.record !== null);
  if (!pet) return null;
  const view = { world, counts: pet.counts, stage: stageOf(pet, now()), onChain };
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
              <span className="quest-state">{st === "claimed" ? t("quest.done") : q.story ? t("quest.inStory") : `+${q.reward.coins}`}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const HOME_ROOM = HOME;

/** D2: on a market day, the Corner Shop's stall with the day's rare thing (sold once, while the day lasts). */
function MarketStall() {
  const { lang } = useLang();
  const zh = lang === "zh";
  const world = useWorld((s) => s.world);
  const buyMarket = useWorld((s) => s.buyMarket);
  const h = happeningAt(world, now());
  if (h.kind !== "market" || world.room !== MARKET_ROOM) return null;
  const it = ITEM[h.item]!;
  const sold = happeningUsed(world, now());
  // D24: the last one goes at half price in the evening
  const price = marketPrice(world, now());
  const evening = villageEvening(world, now());
  return (
    <section className="market-stall">
      <p className="label">{zh ? "今天的集市摊" : "Today's market stall"}</p>
      <ul className="bag-list">
        <li className="bag-item">
          <img className="pixel" src={it.art} alt="" width={40} height={40} />
          <div className="bag-text">
            <b>{it.name[zh ? "zh" : "en"]}</b>
            <span>
              {zh ? "只在今天卖，平时只能找到。" : "On sale today only; any other day it has to be found."}
              {evening ? (zh ? " 傍晚了，最后一个半价。" : " It is evening: the last one is half price.") : ""}
            </span>
          </div>
          <button type="button" className="btn primary" disabled={sold || world.coins < price} onClick={() => buyMarket()}>
            {sold ? (zh ? "已买" : "Bought") : `${zh ? "买" : "Buy"} · ${price}`}
          </button>
        </li>
      </ul>
    </section>
  );
}
