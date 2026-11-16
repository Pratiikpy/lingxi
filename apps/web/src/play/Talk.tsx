/**
 * Talking to a character: their lines type out in a bubble, then the player picks a topic. Their quests live here
 * too (plan 4.2): an errand they want to give ("!"), one ready to take back ("✓"), and, for an errand that asks
 * for something, a button to hand it over.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  type Action,
  type Character,
  FRIEND_BY_ID,
  type FriendStep,
  ITEM,
  type Line,
  QUEST_BY_ID,
  type QuestDef,
  type QuestLine,
  openSteps,
  questProgress,
  shelfOf,
  topicsOf,
} from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import "./talk.css";
import { noteTally } from "../game/tally";
import { allStatuses, conditionView, handIn, questsOf, takeQuest } from "../game/quests";
import { useWorld } from "../game/world";
import { buyFromNeighbour, giftNeighbour, greetingFor, meetNeighbourAtHome, takeNeighbourStep } from "../game/neighbours";
import { GiftPicker, NeighbourNoteLine, TrustStrip } from "./Neighbours";

/** What an errand still wants handed to this resident: the item, how many are still owed, and how many are in the bag. */
function owed(q: QuestDef, who: string, world: ReturnType<typeof useWorld.getState>["world"]): Array<{ item: number; left: number; have: number }> {
  const progress = questProgress(q, world, conditionView());
  return q.objectives.flatMap((o, i) => {
    const idx = String(o.cond.index ?? "");
    if (o.cond.type !== "GIVE_TO" || !idx.startsWith(`${who}:`) || progress[i]?.met) return [];
    const item = Number(idx.split(":")[1]);
    return [{ item, left: (progress[i]?.need ?? 1) - (progress[i]?.have ?? 0), have: world.bag[item] ?? 0 }];
  });
}

const ACTION_LABEL: Record<Action, [string, string]> = {
  shop: ["Open the shop", "打开商店"],
  map: ["Open the map", "打开地图"],
  quests: ["See errands", "看看差事"],
  mind: ["Teach my pet", "去教宠物"],
  spar: ["Go to spars", "去切磋"],
  bag: ["Open my bag", "打开背包"],
  proof: ["See the proof", "查看证明"],
};

export function Talk({ who, visiting = false, onFace, onAction, onClose }: { who: Character; visiting?: boolean; onFace: (face: string) => void; onAction: (a: Action) => void; onClose: () => void }) {
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const sheet = FRIEND_BY_ID[who.id];
  const asLines = (lines: readonly QuestLine[]): Line[] => lines.map((l) => ({ face: l.face ?? who.greeting[0]!.face, en: l.en, zh: l.zh }));
  // a resident visiting your home greets you there, and leaves their keepsake as you meet
  const visitLines = useMemo(() => {
    const u = sheet?.steps.find((s) => s.unlock.kind === "visit")?.unlock;
    return u?.kind === "visit" ? u.lines : null;
  }, [sheet]);
  // the greeting is chosen by the resident's own circuit (plan 4.11)
  const [queue, setQueue] = useState<Line[]>(() => (visiting && visitLines ? asLines(visitLines) : greetingFor(who.id, who.greeting)));
  // the keepsake is left once, as you meet them (meeting twice does nothing)
  useEffect(() => {
    if (visiting) meetNeighbourAtHome(who.id);
  }, [visiting, who.id]);
  const [picking, setPicking] = useState(false);
  const [at, setAt] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [typed, setTyped] = useState(0);
  const [ending, setEnding] = useState(false);
  // an errand being offered: its lines play, then Okay / Not now
  const [offering, setOffering] = useState<string | null>(null);
  const world = useWorld((s) => s.world);
  const quests = useMemo(() => questsOf(who.id, allStatuses()), [who.id, world]);
  // a daily that asks for any small gift can be settled with any resident
  const dailyGift = useMemo(() => {
    const st = allStatuses();
    return (world.quests?.today?.offered ?? []).map((id) => QUEST_BY_ID[id]!).find((q) => st[q.id] === "active" && q.objectives.some((o) => o.cond.type === "GIVE"));
  }, [world]);
  const spare = useMemo(() => {
    // never offer up something an errand still asks for
    const st = allStatuses();
    const wanted = new Set<number>();
    for (const q of Object.values(QUEST_BY_ID)) {
      if (st[q.id] !== "active") continue;
      for (const o of q.objectives) if (o.cond.type === "GIVE_TO" || o.cond.type === "GIVE" || o.cond.type === "ITEM") wanted.add(Number(String(o.cond.index ?? "").split(":").pop()));
    }
    const items = Object.entries(world.bag).filter(([id, n]) => n > 0 && ITEM[Number(id)]?.kind === "material" && !wanted.has(Number(id)));
    items.sort((a, b) => b[1] - a[1]);
    return items[0] ? Number(items[0][0]) : null;
  }, [world]);
  const line = queue[at] ?? null;
  // talking to a resident counts for quests and dailies, once per conversation
  useEffect(() => {
    noteTally("TALK", who.id);
  }, [who.id]);
  const text = line ? line[lang] : "";

  useEffect(() => {
    if (line) onFace(line.face);
  }, [line, onFace]);
  useEffect(() => {
    setTyped(reduce ? text.length : 0);
  }, [text, reduce]);
  useEffect(() => {
    if (typed >= text.length) return;
    const id = setTimeout(() => setTyped((n) => Math.min(text.length, n + (lang === "zh" ? 1 : 2))), 24);
    return () => clearTimeout(id);
  }, [typed, text, lang]);

  const done = typed >= text.length;
  const lastLine = at >= queue.length - 1;
  const advance = () => {
    if (!done) return setTyped(text.length);
    play("tap");
    if (!lastLine) return setAt((n) => n + 1);
    if (ending) return onClose();
  };
  const hear = (q: QuestDef) => {
    play("tap");
    setQueue(asLines(q.intro));
    setAt(0);
    setAction(null);
    setOffering(q.id);
  };
  // after the answer the talk goes back to its choices, with the errand's last line still showing
  const accept = (yes: boolean) => {
    // taking it on plays its own sound
    if (yes && offering) takeQuest(offering);
    else play("tap");
    setOffering(null);
  };
  const finish = (q: QuestDef) => {
    if (!handIn(q.id)) return;
    setQueue(asLines(q.outro));
    setAt(0);
    setAction(null);
    setOffering(null);
  };
  const hand = (q: QuestDef, item: number, n: number) => {
    if (useWorld.getState().giveTo(who.id, item, n)) play("success");
    // handing over the last of it may finish the errand at once
    const after = allStatuses()[q.id];
    if (after === "ready") finish(q);
  };
  // their own topics, then the ones trust has opened
  const topics = useMemo(() => [...who.topics, ...(sheet ? topicsOf(world, sheet) : [])], [who.topics, sheet, world]);
  const steps = useMemo(() => (sheet ? openSteps(world, sheet) : []), [sheet, world]);
  const shelf = useMemo(() => (sheet ? shelfOf(world, sheet) : []), [sheet, world]);
  const step = (s: FriendStep) => {
    if (!takeNeighbourStep(who.id, s.id)) return;
    setQueue(asLines(s.lines));
    setAt(0);
    setAction(null);
  };
  const gift = (item: number) => {
    setPicking(false);
    const r = giftNeighbour(who.id, item);
    if (!r || !sheet) return;
    setQueue(asLines([sheet.reactions[r.taste]]));
    setAt(0);
    setAction(null);
  };
  const pickTopic = (i: number) => {
    play("tap");
    const t = topics[i]!;
    setQueue(t.lines);
    setAt(0);
    setAction(t.action ?? null);
  };
  const sayBye = () => {
    play("tap");
    setQueue([who.bye]);
    setAt(0);
    setAction(null);
    setEnding(true);
  };
  const showChoices = done && lastLine && !ending;

  return (
    <motion.div className="talk" role="dialog" aria-label={who.name[lang]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
      <button type="button" className="talk-bubble" onClick={advance} aria-live="polite">
        <span className="talk-name" style={{ background: who.color }}>
          {who.name[lang]}
          <small>{who.role[lang]}</small>
        </span>
        <span className="talk-text">
          {text.slice(0, typed)}
          <span className="talk-ghost" aria-hidden="true">
            {text.slice(typed)}
          </span>
        </span>
        {done && (!lastLine || ending) && <span className="talk-more" aria-hidden="true">▼</span>}
      </button>
      {showChoices && offering && (
        <div className="talk-choices">
          <button type="button" className="talk-choice go" onClick={() => accept(true)}>
            {lang === "zh" ? "好呀！" : "Okay!"}
          </button>
          <button type="button" className="talk-choice bye" onClick={() => accept(false)}>
            {lang === "zh" ? "现在不了" : "Not now"}
          </button>
        </div>
      )}
      {sheet && <TrustStrip who={who.id} />}
      <NeighbourNoteLine who={who.id} />
      {showChoices && !offering && picking && sheet && <GiftPicker sheet={sheet} onGive={gift} onBack={() => (play("tap"), setPicking(false))} />}
      {showChoices && !offering && !picking && (
        <div className="talk-choices">
          {quests.ready.map((q) => (
            <button key={q.id} type="button" className="talk-choice quest ready" onClick={() => finish(q)}>
              <span className="tq-mark" aria-hidden="true">✓</span>
              {lang === "zh" ? `交任务：${q.title.zh}` : `Hand in: ${q.title.en}`}
            </button>
          ))}
          {quests.active.flatMap((q) =>
            owed(q, who.id, world).map((o) => (
              <button key={`${q.id}:${o.item}`} type="button" className="talk-choice quest" disabled={o.have < 1} onClick={() => hand(q, o.item, Math.min(o.left, o.have))}>
                {lang === "zh"
                  ? `交给${who.name.zh} ${Math.min(o.left, Math.max(1, o.have))} 个${ITEM[o.item]?.name.zh}（还差 ${o.left}，你有 ${o.have}）`
                  : `Give ${Math.min(o.left, Math.max(1, o.have))} × ${ITEM[o.item]?.name.en} (${o.left} still wanted, you have ${o.have})`}
              </button>
            )),
          )}
          {dailyGift && spare !== null && (
            <button type="button" className="talk-choice quest" onClick={() => useWorld.getState().giveTo(who.id, spare, 1) && play("success")}>
              {lang === "zh" ? `送${who.name.zh}一个${ITEM[spare]?.name.zh}` : `Give ${who.name.en} a ${ITEM[spare]?.name.en}`}
            </button>
          )}
          {quests.offer.map((q) => (
            <button key={q.id} type="button" className="talk-choice quest offer" onClick={() => hear(q)}>
              <span className="tq-mark" aria-hidden="true">!</span>
              {q.title[lang]}
            </button>
          ))}
          {steps.length === 2 && steps.every((s) => s.choice) && (
            <span className="talk-branch">{lang === "zh" ? "选一个，另一个就不能再选了：" : "Choose one; the other closes for good:"}</span>
          )}
          {steps.map((s) => (
            <button key={s.id} type="button" className="talk-choice step" onClick={() => step(s)}>
              <span className="tq-mark" aria-hidden="true">★</span>
              {(s.choice ?? s.title)[lang]}
            </button>
          ))}
          {shelf.map((o) => (
            <button key={o.item} type="button" className="talk-choice" disabled={world.coins < o.price} onClick={() => buyFromNeighbour(who.id, o.item)}>
              {lang === "zh" ? `买${ITEM[o.item]?.name.zh} · ${o.price} 金币` : `Buy ${ITEM[o.item]?.name.en} · ${o.price} coins`}
            </button>
          ))}
          {sheet && (
            <button type="button" className="talk-choice" onClick={() => (play("tap"), setPicking(true))}>
              {lang === "zh" ? "送礼物" : "Give a gift"}
            </button>
          )}
          {action && (
            <button type="button" className="talk-choice go" onClick={() => (play("tap"), onAction(action))}>
              {ACTION_LABEL[action][lang === "zh" ? 1 : 0]}
            </button>
          )}
          {topics.map((t, i) => (
            <button key={i} type="button" className="talk-choice" onClick={() => pickTopic(i)}>
              {t.ask[lang]}
            </button>
          ))}
          <button type="button" className="talk-choice bye" onClick={sayBye}>
            {lang === "zh" ? "再见" : "Goodbye"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
