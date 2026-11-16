/**
 * The quest screens (plan 4.2, 36-QUEST-LINE.md §2): the quest book (Story, Today, Milestones), a card per quest
 * with its progress counted from when it was taken, the dialog for the pet's and Builders' Lane quests, the toast
 * when a quest opens or is ready, the pet's "!" bubble, and the ring that points at the right button during the
 * first eleven quests. Residents' quests are offered and taken back inside their talk (Talk.tsx).
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BUILDER_PET, type BuilderId } from "@lingxi/game";
import { wearableOf } from "@lingxi/art";
import {
  CHARACTERS,
  DAILIES,
  DECOR_BY_ID,
  ITEM,
  ONBOARDING,
  QUEST_BY_ID,
  type QuestDef,
  type QuestStatus,
  ROOMS,
  type Reward,
  STORY,
  TRAVEL_RECIPES,
  WEEKLY_DAYS,
  questProgress,
  weeklyGiftsWaiting,
} from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { useGame } from "../game/store";
import { useWorld } from "../game/world";
import { allStatuses, conditionView, giverRoom, handIn, putDown, takeQuest, takeWeeklyGift, useQuestUi } from "../game/quests";
import { QuestPanel } from "./WorldPanels";
import "./quests.css";

type Lang = "en" | "zh";
const residentName = (id: string) => CHARACTERS.find((c) => c.id === id)?.name;

/** Who gives a quest, in the reader's language. */
export function giverName(q: QuestDef, lang: Lang, petName: string): string {
  if (q.giver === "pet") return petName;
  if (q.giver.startsWith("lane:")) return BUILDER_PET[q.giver.slice(5) as BuilderId]?.name[lang] ?? q.giver;
  return residentName(q.giver)?.[lang] ?? q.giver;
}

/** Where to find the giver, for a quest that is handed in in person. */
function whereText(q: QuestDef, lang: Lang): string | null {
  if (q.giver === "pet") return null;
  const room = q.giver.startsWith("lane:") ? BUILDER_PET[q.giver.slice(5) as BuilderId]?.room : giverRoom[q.giver];
  const name = room !== undefined ? ROOMS[room]?.name[lang] : null;
  return name ? (lang === "zh" ? `在${name}` : `at ${name}`) : null;
}

export function rewardText(r: Reward, lang: Lang): string | null {
  const zh = lang === "zh";
  switch (r.kind) {
    case "coins":
      return zh ? `${r.n} 金币` : `${r.n} coins`;
    case "item":
      return `${ITEM[r.item]?.name[lang] ?? r.item}${r.n > 1 ? ` ×${r.n}` : ""}`;
    case "trust":
      return zh ? `${residentName(r.who)?.zh ?? r.who}的信任 +${r.n}` : `+${r.n} trust with ${residentName(r.who)?.en ?? r.who}`;
    case "piece":
      return wearableOf(r.id)?.name[lang] ?? r.id;
    case "decor":
      return DECOR_BY_ID[r.id]?.name[lang] ?? r.id;
    case "recipe": {
      const t = TRAVEL_RECIPES.find((x) => x.index === r.index);
      return t ? (zh ? `配方：${t.name.zh}` : `Recipe: ${t.name.en}`) : null;
    }
    case "flag":
      return null; // a flag opens something in the story; the closing lines say what
  }
}

function Rewards({ rewards, lang }: { rewards: readonly Reward[]; lang: Lang }) {
  const shown = rewards.map((r) => rewardText(r, lang)).filter((x): x is string => !!x);
  if (!shown.length) return null;
  return (
    <ul className="qc-rewards" aria-label={lang === "zh" ? "奖励" : "Rewards"}>
      {shown.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** One quest: who asks, what is asked (with progress), what it gives, and the one thing to do next. */
export function QuestCard({ q, status }: { q: QuestDef; status: QuestStatus }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const pet = useGame((s) => s.pet);
  const setOpen = useQuestUi((s) => s.setOpen);
  const progress = useMemo(() => (status === "active" || status === "ready" ? questProgress(q, world, conditionView()) : null), [q, status, world]);
  const counting = q.objectives.some((o) => o.cond.logic.startsWith("INC") || o.cond.of?.some((x) => x.logic.startsWith("INC")));
  const where = whereText(q, lang);
  const inPerson = q.giver !== "pet" && q.kind === "story";
  return (
    <li className={`qc qc-${status}`}>
      <div className="qc-head">
        <b>{q.title[lang]}</b>
        <span className="qc-from">{L(`From ${giverName(q, lang, pet?.name ?? "")}`, `来自${giverName(q, lang, pet?.name ?? "")}`)}{where ? ` · ${where}` : ""}</span>
      </div>
      {status === "locked" && q.opensWhen && <p className="small qc-opens">{q.opensWhen[lang]}</p>}
      {status !== "locked" && (
        <ul className="qc-objs">
          {q.objectives.map((o, i) => {
            const p = progress?.[i];
            const need = Math.max(1, p?.need ?? 1);
            const have = Math.min(need, p?.have ?? 0);
            return (
              <li key={i} className={p?.met ? "met" : ""}>
                <span>{p?.met ? "✓ " : ""}{o.text[lang]}</span>
                {p && need > 1 && (
                  <span className="qc-count">
                    {have}/{need}
                  </span>
                )}
                {p && need > 1 && (
                  <div className="bar" aria-hidden="true">
                    <b style={{ transform: `scaleX(${have / need})` }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {status === "active" && counting && <p className="small qc-note">{L("Counts from when you took it on.", "从接下任务的那一刻开始算。")}</p>}
      <Rewards rewards={q.rewards} lang={lang} />
      <div className="qc-actions">
        {status === "available" && !inPerson && (
          <button type="button" className="btn primary" onClick={() => (play("tap"), setOpen(q.id))}>
            {L("Hear it out", "听听看")}
          </button>
        )}
        {status === "available" && inPerson && <span className="small">{L("Go and talk to them to take it on.", "去和他们说话就能接下。")}</span>}
        {status === "ready" && !inPerson && (
          <button type="button" className="btn primary" onClick={() => (play("tap"), setOpen(q.id))}>
            {L("Hand it in", "交任务")}
          </button>
        )}
        {status === "ready" && inPerson && <span className="small qc-go">{L("Done! Go back and tell them.", "完成了！回去告诉他们吧。")}</span>}
        {status === "active" && (
          <button type="button" className="btn ghost small-btn" onClick={() => (play("tap"), putDown(q.id))}>
            {L("Put it down", "先放下")}
          </button>
        )}
      </div>
    </li>
  );
}

const order: QuestStatus[] = ["ready", "active", "available"];

/** The quest book: Story (the 80), Today (3 dailies and the weekly gift), Milestones (the old errands). */
export function QuestBook() {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const pet = useGame((s) => s.pet);
  const [tab, setTab] = useState<"story" | "today" | "milestones">("story");
  const statuses = useMemo(() => allStatuses(), [world, pet]);
  const live = STORY.filter((q) => order.includes(statuses[q.id]!)).sort((a, b) => order.indexOf(statuses[a.id]!) - order.indexOf(statuses[b.id]!));
  const arcs = Array.from({ length: 12 }, (_, i) => {
    const qs = STORY.filter((q) => q.arc === i + 1);
    const doneN = qs.filter((q) => statuses[q.id] === "done").length;
    const next = qs.find((q) => statuses[q.id] === "locked");
    return { arc: i + 1, total: qs.length, done: doneN, next, started: qs.some((q) => statuses[q.id] !== "locked") };
  });
  const today = world.quests?.today;
  const days = world.quests?.days?.length ?? 0;
  const gifts = weeklyGiftsWaiting(world);
  return (
    <div className="questbook">
      <div className="qb-tabs" role="tablist">
        {(
          [
            ["story", L("Story", "故事")],
            ["today", L("Today", "今日")],
            ["milestones", L("Milestones", "里程碑")],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`qb-tab${tab === id ? " on" : ""}`} onClick={() => (play("tap"), setTab(id))}>
            {label}
            {id === "story" && live.some((q) => statuses[q.id] === "ready") && <span className="qb-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      {tab === "story" && (
        <>
          {live.length ? (
            <ul className="qc-list">
              {live.map((q) => (
                <QuestCard key={q.id} q={q} status={statuses[q.id]!} />
              ))}
            </ul>
          ) : (
            <p className="small qb-empty">{L("Nothing waiting right now. Walk somewhere new: residents have things to ask.", "现在没有待办的事。去个新地方走走吧，居民们会有事找你。")}</p>
          )}
          <h3 className="qb-h">{L("Stories", "故事线")}</h3>
          <ul className="qb-arcs">
            {arcs.map((a) => (
              <li key={a.arc} className={a.done === a.total ? "done" : ""}>
                <span className="qb-arc-name">{arcName(a.arc, lang)}</span>
                <span className="qb-arc-count">
                  {a.done}/{a.total}
                </span>
                {!a.started && <span className="small">{arcOpens(a.arc, lang)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === "today" && (
        <>
          {today ? (
            <ul className="qc-list">
              {today.offered.map((id) => (
                <QuestCard key={id} q={QUEST_BY_ID[id]!} status={statuses[id]!} />
              ))}
            </ul>
          ) : (
            <p className="small qb-empty">{L("Today's three appear once your pet is home.", "宠物在家时，今天的三件事就会出现。")}</p>
          )}
          <div className="qb-weekly">
            <div>
              <b>{L("Weekly gift", "每周礼物")}</b>
              <span className="small">{L(`Any ${WEEKLY_DAYS} days with a daily done. No streak to keep. ${days % WEEKLY_DAYS}/${WEEKLY_DAYS} towards the next.`, `任意 ${WEEKLY_DAYS} 天完成过每日任务就行，不用连续。下一份：${days % WEEKLY_DAYS}/${WEEKLY_DAYS}。`)}</span>
            </div>
            <button type="button" className="btn primary" disabled={gifts < 1} onClick={() => takeWeeklyGift()}>
              {gifts > 0 ? L("Open it", "打开") : L("Not yet", "还没到")}
            </button>
          </div>
          <p className="small qb-note">{L(`${DAILIES.length} small things rotate, three a day: one care, one social, one explore. A new three each morning; missing a day costs nothing.`, `${DAILIES.length} 件小事轮流出现，每天三件：照顾、交朋友、探索各一件。每天早上换新的三件；错过一天也没关系。`)}</p>
        </>
      )}
      {tab === "milestones" && <QuestPanel />}
    </div>
  );
}

const ARCS: ReadonlyArray<[string, string]> = [
  ["First days", "最初的日子"],
  ["Wick, lantern keeper", "守灯人灯芯"],
  ["Praline, sweets seller", "糖果店主糖霜"],
  ["Yonder, wayfinder", "引路人阿远"],
  ["Bolt, tinker", "修补匠螺丝"],
  ["Flit, butterfly watcher", "看蝴蝶的蝶叔"],
  ["Nurse Why", "护士小慧"],
  ["Jab, spar coach", "切磋教练阿拳"],
  ["Twain, keeper of the Wheel", "轮之殿的双生者"],
  ["Nimbus, daydreamer", "爱做梦的云朵"],
  ["Builders' Lane", "建设者小路"],
  ["Growing up", "长大"],
];
const arcName = (arc: number, lang: Lang) => ARCS[arc - 1]![lang === "zh" ? 1 : 0];
const ARC_OPENS: Record<number, [string, string]> = {
  1: ["Opens when your pet hatches.", "宠物孵化时开启。"],
  2: ["Opens after your pet's first visit next door.", "宠物第一次去隔壁之后开启。"],
  3: ["Opens after your first shopping trip.", "第一次买东西之后开启。"],
  9: ["Opens after your pet's first lesson.", "宠物上完第一课之后开启。"],
  11: ["Opens when you meet someone on Builders' Lane.", "在建设者小路认识谁之后开启。"],
  12: ["Opens once a day is kept on X Layer.", "在 X Layer 上留住一天之后开启。"],
};
const arcOpens = (arc: number, lang: Lang) => (ARC_OPENS[arc] ?? ["Opens the first time you walk into their room.", "第一次走进他们的房间时开启。"])[lang === "zh" ? 1 : 0];

/**
 * The dialog for quests the pet or a Builders' Lane resident gives. Three ways in: an offer (its lines type out,
 * then you take it on), a quest ready to hand in (hand it in, then the closing lines), or one still under way
 * (where it stands).
 */
export function QuestDialog() {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const reduce = useReducedMotion() ?? false;
  const { open, setOpen } = useQuestUi();
  const pet = useGame((s) => s.pet);
  const world = useWorld((s) => s.world);
  const q = open ? QUEST_BY_ID[open] : undefined;
  const [mode, setMode] = useState<"offer" | "ready" | "closing" | "active">("offer");
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const st = allStatuses()[open];
    setMode(st === "ready" ? "ready" : st === "active" ? "active" : "offer");
    setAt(0);
  }, [open]);
  const progress = useMemo(() => (q && (mode === "active" || mode === "ready") ? questProgress(q, world, conditionView()) : null), [q, mode, world]);
  if (!q || !pet) return null;
  const lines = mode === "closing" ? q.outro : q.intro;
  const shownAt = mode === "active" || mode === "ready" ? lines.length - 1 : Math.min(at, lines.length - 1);
  const line = lines[shownAt]!;
  const last = shownAt >= lines.length - 1;
  const close = () => (play("tap"), setOpen(null));
  return (
    <div className="fam-modal" role="dialog" aria-modal="true" aria-label={q.title[lang]}>
      <motion.div className="fam-card qd" initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
        <p className="qd-title">{q.title[lang]}</p>
        <button type="button" className="qd-bubble" onClick={() => !last && (play("tap"), setAt((n) => n + 1))} aria-live="polite">
          <span className="qd-name">{giverName(q, lang, pet.name)}</span>
          <span className="qd-text">{line[lang]}</span>
          {!last && (
            <span className="talk-more" aria-hidden="true">
              ▼
            </span>
          )}
        </button>
        {(mode === "offer" ? last : mode !== "closing") && (
          <ul className="qc-objs">
            {q.objectives.map((o, i) => (
              <li key={i} className={progress?.[i]?.met ? "met" : ""}>
                {progress?.[i]?.met ? "✓ " : ""}
                {o.text[lang]}
                {progress?.[i] && (progress[i]!.need ?? 1) > 1 ? ` · ${Math.min(progress[i]!.have, progress[i]!.need)}/${progress[i]!.need}` : ""}
              </li>
            ))}
          </ul>
        )}
        {(mode === "offer" ? last : mode === "ready") && <Rewards rewards={q.rewards} lang={lang} />}
        <div className="row">
          {mode === "offer" && last && (
            <button type="button" className="btn primary" onClick={() => takeQuest(q.id) && setOpen(null)}>
              {L("Okay!", "好呀！")}
            </button>
          )}
          {mode === "ready" && (
            <button type="button" className="btn primary" onClick={() => handIn(q.id) && (setMode("closing"), setAt(0))}>
              {L("Hand it in", "交任务")}
            </button>
          )}
          {(mode !== "offer" || last) && (
            <button type="button" className="btn" onClick={close}>
              {mode === "closing" ? (last ? L("Lovely", "太好了") : L("Close", "关闭")) : mode === "offer" ? L("Not now", "现在不了") : L("Close", "关闭")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** A quest opened, became ready, or was handed in: one short note, tap to open the book. */
export function QuestToast({ onOpenBook }: { onOpenBook: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const note = useQuestUi((s) => s.note);
  const dismiss = useQuestUi((s) => s.dismiss);
  const pet = useGame((s) => s.pet);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(dismiss, note.kind === "done" ? 5200 : 4200);
    return () => clearTimeout(id);
  }, [note, dismiss]);
  const q = note ? QUEST_BY_ID[note.quest] : undefined;
  const who = q ? giverName(q, lang, pet?.name ?? "") : "";
  const text = !note || !q
    ? ""
    : note.kind === "new"
      ? lang === "zh"
        ? `${who}有事找你：「${q.title.zh}」`
        : `${who} has something for you: “${q.title.en}”`
      : note.kind === "ready"
        ? q.giver === "pet" || q.kind === "daily"
          ? lang === "zh"
            ? `「${q.title.zh}」完成了！点 ✓ 交任务。`
            : `“${q.title.en}” is done! Tap the ✓ to hand it in.`
          : lang === "zh"
            ? `「${q.title.zh}」完成了，去告诉${who}吧`
            : `“${q.title.en}” is done. Go and tell ${who}.`
        : lang === "zh"
          ? `「${q.title.zh}」：${(note.rewards ?? []).map((r) => rewardText(r, lang)).filter(Boolean).join("、")}`
          : `“${q.title.en}”: ${(note.rewards ?? []).map((r) => rewardText(r, lang)).filter(Boolean).join(", ")}`;
  return (
    <AnimatePresence>
      {note && q && (
        <motion.button
          key={note.id}
          type="button"
          className={`quest-toast qt-${note.kind}`}
          role="status"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          onClick={() => (dismiss(), onOpenBook())}
        >
          <span className="qt-mark" aria-hidden="true">
            {note.kind === "new" ? "!" : note.kind === "ready" ? "✓" : "★"}
          </span>
          {text}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** The pet's own "!" when it has something to ask or a quest to take back; tap to hear it. */
export function PetQuestBubble() {
  const lang = useLang((s) => s.lang) as Lang;
  const world = useWorld((s) => s.world);
  const pet = useGame((s) => s.pet);
  const setOpen = useQuestUi((s) => s.setOpen);
  const statuses = useMemo(() => allStatuses(), [world, pet]);
  const mine = STORY.filter((q) => q.giver === "pet");
  const ready = mine.find((q) => statuses[q.id] === "ready");
  const offer = mine.find((q) => statuses[q.id] === "available");
  const q = ready ?? offer;
  if (!q || !pet || pet.away || pet.sitting) return null;
  return (
    <button type="button" className={`pet-quest${ready ? " ready" : ""}`} onClick={() => (play("tap"), setOpen(q.id))} aria-label={lang === "zh" ? `${pet.name}有话想说：${q.title.zh}` : `${pet.name} wants to say something: ${q.title.en}`}>
      <span aria-hidden="true">{ready ? "✓" : "!"}</span>
    </button>
  );
}

/** A Builders' Lane resident's quests, on their card: offer, or take back. */
export function LaneQuests({ id }: { id: string }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const setOpen = useQuestUi((s) => s.setOpen);
  const statuses = useMemo(() => allStatuses(), [world]);
  const mine = STORY.filter((q) => q.giver === `lane:${id}` && ["available", "ready", "active"].includes(statuses[q.id]!));
  if (!mine.length) return null;
  return (
    <ul className="lane-quests">
      {mine.map((q) => (
        <li key={q.id}>
          <span>
            {statuses[q.id] === "ready" ? "✓ " : statuses[q.id] === "available" ? "! " : ""}
            {q.title[lang]}
          </span>
          {statuses[q.id] !== "active" && (
            <button type="button" className="btn primary" onClick={() => (play("tap"), setOpen(q.id))}>
              {statuses[q.id] === "ready" ? L("Hand it in", "交任务") : L("Hear it out", "听听看")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Where each onboarding hint points: the button itself, or the tab that leads to it. */
const HINT_TARGETS: Record<string, string[]> = {
  pet: ["pet"],
  feed: ["feed"],
  clean: ["clean"],
  play: ["play"],
  sleep: ["sleep"],
  map: ["tab-map"],
  look: ["look"],
  bag: ["tab-bag"],
  teach: ["teach", "tab-mind"],
  keep: ["keep", "tab-me"],
};

/** During the first eleven quests, a soft ring around the one control the active quest is about. */
export function HintRing() {
  const world = useWorld((s) => s.world);
  const [box, setBox] = useState<DOMRect | null>(null);
  const reduce = useReducedMotion() ?? false;
  const hint = useMemo(() => {
    const statuses = allStatuses();
    const q = ONBOARDING.map((id) => QUEST_BY_ID[id]!).find((x) => statuses[x.id] === "active");
    return q?.hint ?? null;
  }, [world]);
  useEffect(() => {
    if (!hint) return setBox(null);
    const find = () => {
      for (const t of HINT_TARGETS[hint] ?? [hint]) {
        const el = document.querySelector<HTMLElement>(`[data-hint="${t}"]`);
        if (el && el.offsetParent !== null) return setBox(el.getBoundingClientRect());
      }
      setBox(null);
    };
    find();
    const id = setInterval(find, 500);
    window.addEventListener("resize", find);
    return () => (clearInterval(id), window.removeEventListener("resize", find));
  }, [hint]);
  if (!box) return null;
  return <div className={`hint-ring${reduce ? " still" : ""}`} aria-hidden="true" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} />;
}
