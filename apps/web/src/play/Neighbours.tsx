/**
 * Neighbours (plan 4.3): trust with the residents and the Builders' Lane pets. The strip under a conversation, the
 * note that says what a gift or a step did, the gift picker that remembers each neighbour's taste, the list of all
 * fourteen in the Pet sheet, and the part of a lane card where a lane pet's friendship lives.
 */

import { useEffect, useMemo, useState } from "react";
import { BUILDER_PET, type BuilderId } from "@lingxi/game";
import {
  CHARACTERS,
  FRIENDS,
  FRIEND_BY_ID,
  type FriendSheet,
  type FriendStep,
  ITEM,
  LEVEL_NAMES,
  TRAVEL_RECIPES,
  type Taste,
  type Unlock,
  friendLevel,
  friendsOf,
  nextLevel,
  openSteps,
  pointsFor,
  tasteOf,
  topicsOf,
  trustOf,
} from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { useWorld } from "../game/world";
import { giftNeighbour, takeNeighbourStep, useNeighbourNote } from "../game/neighbours";
import { rewardText } from "./Quests";
import "./neighbours.css";

type Lang = "en" | "zh";

export const neighbourName = (id: string, lang: Lang): string =>
  CHARACTERS.find((c) => c.id === id)?.name[lang] ?? BUILDER_PET[id as BuilderId]?.name[lang] ?? id;

const TASTE_MARK: Record<Taste, string> = { love: "♥", like: "✓", neutral: "·", dislike: "✗" };
const TASTE_WORD: Record<Taste, [string, string]> = { love: ["loves it", "超喜欢"], like: ["likes it", "喜欢"], neutral: ["takes it kindly", "收下了"], dislike: ["turns it down", "不要"] };

/** What a step opened, in one line. */
export function unlockText(u: Unlock, who: string, lang: Lang): string {
  const zh = lang === "zh";
  const name = neighbourName(who, lang);
  switch (u.kind) {
    case "topic":
      return zh ? `新话题：${u.topic.ask.zh}` : `New to ask about: ${u.topic.ask.en}`;
    case "shelf":
      return zh ? `${name}以后会卖你${ITEM[u.item]?.name.zh}（${u.price} 金币）` : `${name} will sell you ${ITEM[u.item]?.name.en} (${u.price} coins)`;
    case "recipe": {
      const r = TRAVEL_RECIPES.find((t) => t.index === u.index);
      return zh ? `学会了：${r?.name.zh}` : `Learned: ${r?.name.en}`;
    }
    case "visit":
      return zh ? `${name}要来你家了，回家就能见到` : `${name} is on the way to your home; go home to meet them`;
    case "gift":
      return (zh ? "你得到了：" : "You got: ") + u.rewards.map((r) => rewardText(r, lang)).filter(Boolean).join(zh ? "、" : ", ");
  }
}

/** Level name, trust points and the way to the next level. */
export function TrustStrip({ who }: { who: string }) {
  const lang = useLang((s) => s.lang) as Lang;
  const points = useWorld((s) => trustOf(s.world, who));
  const lvl = friendLevel(points);
  const from = pointsFor(lvl);
  const to = lvl < 6 ? pointsFor(lvl + 1) : null;
  const frac = to === null ? 1 : (points - from) / (to - from);
  return (
    <div className="nb-trust" aria-label={lang === "zh" ? `信任：${LEVEL_NAMES[lvl - 1]!.zh}` : `Trust: ${LEVEL_NAMES[lvl - 1]!.en}`}>
      <span className="nb-level">
        <b>{lvl}</b> {LEVEL_NAMES[lvl - 1]![lang]}
      </span>
      <span className="nb-bar" aria-hidden="true">
        <b style={{ transform: `scaleX(${Math.max(0.02, frac)})` }} />
      </span>
      <span className="nb-points">{to === null ? (lang === "zh" ? "最高" : "max") : `${points}/${to}`}</span>
    </div>
  );
}

/** What just happened with this neighbour, for a few seconds. */
export function NeighbourNoteLine({ who }: { who: string }) {
  const lang = useLang((s) => s.lang) as Lang;
  const zh = lang === "zh";
  const note = useNeighbourNote((s) => (s.note?.who === who ? s.note : null));
  const clear = useNeighbourNote((s) => s.set);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => clear(null), 7000);
    return () => clearTimeout(id);
  }, [note, clear]);
  if (!note) return null;
  let text = "";
  if (note.kind === "gift" && note.taste) {
    const [en, cn] = TASTE_WORD[note.taste];
    text =
      note.taste === "dislike"
        ? zh
          ? "没收下，东西还在你包里。"
          : "Turned down; it's still in your bag."
        : note.trust
          ? zh
            ? `${cn} · 信任 +${note.trust}`
            : `${en[0]!.toUpperCase()}${en.slice(1)} · +${note.trust} trust`
          : zh
            ? `${cn} · 今天的信任已经加过了（每天只有第一份礼物加信任）`
            : `${en[0]!.toUpperCase()}${en.slice(1)} · trust already rose today (only the day's first gift counts)`;
  } else if (note.kind === "step" && note.unlock) text = unlockText(note.unlock, who, lang);
  else if (note.kind === "visit") text = (zh ? "留给你：" : "Left for you: ") + (note.rewards ?? []).map((r) => rewardText(r, lang)).filter(Boolean).join(zh ? "、" : ", ");
  else if (note.kind === "buy") text = zh ? "买好了，在你包里。" : "Bought; it's in your bag.";
  else if (note.kind === "fail") text = note.reason === "coins" ? (zh ? "金币不够。" : "Not enough coins.") : zh ? "现在还不行。" : "Not just now.";
  return (
    <p className={`nb-note nb-${note.kind}${note.taste ? ` nb-${note.taste}` : ""}`} role="status">
      {text}
    </p>
  );
}

/** A resident whose taste is not yet known: one shared empty list, so the gift list is not worked out again for nothing. */
const NOTHING_KNOWN: readonly number[] = [];

/** Choose something from the bag to give; what you have learnt of their taste is marked. */
export function GiftPicker({ sheet, onGive, onBack }: { sheet: FriendSheet; onGive: (item: number) => void; onBack: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const world = useWorld((s) => s.world);
  const known = friendsOf(world).known[sheet.id] ?? NOTHING_KNOWN;
  const items = useMemo(() => {
    const order: Record<Taste, number> = { love: 0, like: 1, neutral: 2, dislike: 3 };
    return Object.entries(world.bag)
      .filter(([id, n]) => n > 0 && ITEM[Number(id)])
      .map(([id, n]) => ({ item: Number(id), n, taste: known.includes(Number(id)) ? tasteOf(sheet, Number(id)) : null }))
      .sort((a, b) => (a.taste ? order[a.taste] : 2) - (b.taste ? order[b.taste] : 2) || a.item - b.item);
  }, [world.bag, known, sheet]);
  return (
    <div className="nb-picker" role="group" aria-label={lang === "zh" ? "选一份礼物" : "Choose a gift"}>
      <p className="nb-picker-head">{lang === "zh" ? "送什么？♥ 超喜欢 ✓ 喜欢 ✗ 不要（送过才知道）" : "What will you give? ♥ loves ✓ likes ✗ turns down (learnt by giving)"}</p>
      {items.length ? (
        <ul>
          {items.map((x) => (
            <li key={x.item}>
              <button type="button" className={`nb-item${x.taste ? ` t-${x.taste}` : ""}`} onClick={() => onGive(x.item)}>
                {ITEM[x.item]?.art && <img src={ITEM[x.item]!.art} width={24} height={24} alt="" aria-hidden="true" className="pixel" />}
                <span>{ITEM[x.item]!.name[lang]}</span>
                <small>×{x.n}</small>
                {x.taste && (
                  <em className="nb-taste" title={TASTE_WORD[x.taste][lang === "zh" ? 1 : 0]}>
                    {TASTE_MARK[x.taste]}
                  </em>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">{lang === "zh" ? "包里是空的。出去找找吧。" : "Your bag is empty. Go and find something."}</p>
      )}
      <button type="button" className="talk-choice bye" onClick={onBack}>
        {lang === "zh" ? "返回" : "Back"}
      </button>
    </div>
  );
}

/** A lane pet's friendship, on its card: trust, an open step, gifts, and the stories it has told. */
export function LaneFriendship({ id }: { id: string }) {
  const lang = useLang((s) => s.lang) as Lang;
  const world = useWorld((s) => s.world);
  const sheet = FRIEND_BY_ID[id];
  const [said, setSaid] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  if (!sheet) return null;
  const steps = openSteps(world, sheet);
  const topics = topicsOf(world, sheet);
  const take = (s: FriendStep) => {
    if (takeNeighbourStep(id, s.id)) setSaid(s.lines.map((l) => l[lang]).join(" "));
  };
  const give = (item: number) => {
    setPicking(false);
    const r = giftNeighbour(id, item);
    if (r) setSaid(sheet.reactions[r.taste][lang]);
  };
  return (
    <section className="nb-lane" aria-label={lang === "zh" ? "交情" : "Friendship"}>
      <TrustStrip who={id} />
      {said && <p className="nb-said">“{said}”</p>}
      <NeighbourNoteLine who={id} />
      {picking ? (
        <GiftPicker sheet={sheet} onGive={give} onBack={() => (play("tap"), setPicking(false))} />
      ) : (
        <div className="talk-choices">
          {steps.length === 2 && steps.every((s) => s.choice) && <span className="talk-branch">{lang === "zh" ? "选一个，另一个就不能再选了：" : "Choose one; the other closes for good:"}</span>}
          {steps.map((s) => (
            <button key={s.id} type="button" className="talk-choice step" onClick={() => take(s)}>
              <span className="tq-mark" aria-hidden="true">★</span>
              {(s.choice ?? s.title)[lang]}
            </button>
          ))}
          <button type="button" className="talk-choice" onClick={() => (play("tap"), setPicking(true))}>
            {lang === "zh" ? "送礼物" : "Give a gift"}
          </button>
        </div>
      )}
      {topics.length > 0 && (
        <ul className="nb-topics">
          {topics.map((t, i) => (
            <li key={t.ask.en}>
              <button type="button" aria-expanded={open === i} onClick={() => (play("tap"), setOpen(open === i ? null : i))}>
                {t.ask[lang]} {open === i ? "▴" : "▾"}
              </button>
              {open === i && t.lines.map((l) => <p key={l.en}>{l[lang]}</p>)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** All fourteen neighbours: where each friendship stands and what the next level opens. */
export function NeighboursPanel() {
  const lang = useLang((s) => s.lang) as Lang;
  const zh = lang === "zh";
  const world = useWorld((s) => s.world);
  return (
    <section className="nb-panel">
      <h3>{zh ? "邻居" : "Neighbours"}</h3>
      <p className="small">
        {zh
          ? "信任来自他们的差事和礼物，永远不会减少。每升一级都会解锁新东西。"
          : "Trust comes from their errands and from gifts, and never fades. Every level opens something new."}
      </p>
      <ul className="nb-list">
        {FRIENDS.map((f) => {
          const c = CHARACTERS.find((x) => x.id === f.id);
          const nx = nextLevel(world, f);
          const waiting = openSteps(world, f).length > 0;
          return (
            <li key={f.id} className={waiting ? "waiting" : ""}>
              {c ? <img className="nb-face" src={`art/npcs/${c.greeting[0]!.face}`} width={36} height={36} alt="" aria-hidden="true" /> : <span className="nb-face nb-lane-face" aria-hidden="true">{f.id === "behemoth" ? "13" : "◆"}</span>}
              <div className="nb-who">
                <b>
                  {neighbourName(f.id, lang)}
                  {waiting && <span className="nb-star" title={zh ? "有新的一步" : "A step is waiting"}>★</span>}
                </b>
                <TrustStrip who={f.id} />
                <span className="small nb-next">
                  {nx
                    ? zh
                      ? `${nx.at} 信任时：${nx.opens.length > 1 ? "二选一" : nx.opens[0] ? unlockShort(nx.opens[0].unlock, lang) : "继续交往"}`
                      : `At ${nx.at} trust: ${nx.opens.length > 1 ? "a choice of two" : nx.opens[0] ? unlockShort(nx.opens[0].unlock, lang) : "keep going"}`
                    : zh
                      ? "知己。"
                      : "Kindred."}
                  {" · "}
                  {c ? c.role[lang] : zh ? "建设者小巷" : "Builders' Lane"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const unlockShort = (u: Unlock, lang: Lang): string => {
  const zh = lang === "zh";
  return u.kind === "topic" ? (zh ? "新话题" : "a new topic") : u.kind === "shelf" ? (zh ? "专属货架" : "their shelf") : u.kind === "recipe" ? (zh ? "一个配方" : "a recipe") : u.kind === "visit" ? (zh ? "来你家做客" : "a visit to your home") : zh ? "一份纪念" : "a keepsake";
};
