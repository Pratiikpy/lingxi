/**
 * "While you were away" (PRD U4): what really happened during an absence,
 * read from the pet's own replayed log (friends who came by, toys, a fright,
 * and what its brain chose to do), and one small thing it found for the bag.
 * Shown once per absence.
 */

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HOME, ITEM, ROOMS } from "@lingxi/world";
import { type Frame, type Pet, awayFind, awaySeed, halvesOf, momentText, rewind, visitorsDuring, skillRules, ruleGrowth } from "@lingxi/game";
import { VisitorArt, useAlbum } from "./Album";
import { useLang } from "../i18n";
import { programFor, useGame } from "../game/store";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { saveWrite } from "../game/saveRuntime";

type Lang = "en" | "zh";
const CLAIMED = "lingxi.away.claimed";

const EVENT_TEXT: Record<number, { en: string; zh: string }> = {
  1: { en: "A friend came by.", zh: "有朋友来串门。" },
  2: { en: "A toy rolled into reach.", zh: "一个玩具滚到了身边。" },
  3: { en: "Something startled it.", zh: "有什么东西吓了它一跳。" },
};

function claimed(key: string): boolean {
  try {
    return localStorage.getItem(CLAIMED) === key;
  } catch {
    return false;
  }
}
function claim(key: string): void {
  try {
    saveWrite(CLAIMED, key);
  } catch {
    // shown again next time at worst; the find is still given once per visit
  }
}

const clock = (f: Frame, lang: Lang) => (f.at === null ? "" : new Date(f.at).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" }));

/** The card for the last long absence, if it belongs to the pet on screen; one card per absence. */
export function WelcomeBack({ pet }: { pet: Pet }) {
  const away = useGame((s) => s.away);
  const mine = away && away.petKey === String(pet.bornAt) ? away : null;
  if (!mine) return null;
  return <AwayCard key={`${mine.petKey}:${mine.to}`} pet={pet} absence={mine} />;
}

/** What happened while the player was away, read once from the pet's log when the absence is first shown. */
function report(pet: Pet, absence: { from: number; to: number }) {
  const frames = rewind(pet, (l, outside, skills) => ({ ...(pet.family ? { halves: halvesOf(pet.family, l, skillRules(ruleGrowth(skills))) } : { program: programFor(pet.line, l, pet.instincts ?? 0, ruleGrowth(skills)) }), ...(outside ? { outside } : {}) }), absence.to - absence.from + 1);
  const window = frames.filter((f) => f.at !== null && f.at >= absence.from * 60_000 && f.at <= absence.to * 60_000);
  return {
    events: window.filter((f) => f.senses.event !== 0).slice(-5),
    napped: window.some((f) => f.want === 3),
    find: awayFind(awaySeed(pet), absence.from, absence.to, ROOMS[HOME]?.drops ?? []),
    // the travelling pets who came by, for the album (M9)
    visits: visitorsDuring(awaySeed(pet), absence.from, absence.to),
  };
}

/** Mounted once per absence (its key), so the story, the find and the visitors are worked out once, as they were. */
function AwayCard({ pet, absence }: { pet: Pet; absence: { petKey: string; from: number; to: number } }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const clear = useGame((s) => s.clearAway);
  const receive = useWorld((s) => s.receive);
  const addVisits = useAlbum((s) => s.add);
  const key = `${absence.petKey}:${absence.to}`;
  const [{ events, napped, find, visits }] = useState(() => report(pet, absence));
  const story = { events, napped };
  useEffect(() => {
    if (visits.length) addVisits(key, visits);
  }, [key, visits, addVisits]);
  useEffect(() => {
    // the find goes into the bag once per absence, even if the card is shown again
    if (claimed(key)) return;
    claim(key);
    if (find !== null) receive(find, 1);
  }, [key, find, receive]);

  const hours = Math.max(1, Math.round((absence.to - absence.from) / 60));
  const item = find !== null ? ITEM[find] : undefined;
  return (
    <div className="fam-modal" role="dialog" aria-modal="true" aria-label={lang === "zh" ? "你不在的时候" : "While you were away"}>
      <motion.div className="fam-card welcome-card" initial={reduce ? false : { y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
        <p className="label">{lang === "zh" ? `你不在的这 ${hours} 小时` : `While you were away · ${hours} ${hours === 1 ? "hour" : "hours"}`}</p>
        {visits.length > 0 && (
          <div className="welcome-visitors">
            <p className="small">{lang === "zh" ? "来串门的：" : "Who came by:"}</p>
            <ul>
              {[...new Map(visits.map((v) => [v.visitor.id, v.visitor])).values()].slice(0, 4).map((v) => (
                <li key={v.id}>
                  <VisitorArt v={v} scale={2} />
                  <span>
                    {v.name[lang]}
                    {visits.filter((x) => x.visitor.id === v.id).length > 1 ? ` ×${visits.filter((x) => x.visitor.id === v.id).length}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {story.events.length ? (
          <ul className="welcome-list">
            {story.events.map((f) => (
              <li key={f.index}>
                <b>{clock(f, lang)}</b> {EVENT_TEXT[f.senses.event]![lang]} <span>{lang === "zh" ? `${pet.name}：` : `${pet.name}: `}“{momentText(f, lang)}”</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{lang === "zh" ? `一切都很安静。${pet.name}${story.napped ? "睡了一会儿，" : ""}自己玩了一阵。` : `All quiet. ${pet.name}${story.napped ? " napped a while and" : ""} kept itself busy.`}</p>
        )}
        {item && (
          <p className="welcome-find">
            <img className="pixel" src={item.art} alt="" width={32} height={32} />
            {lang === "zh" ? `它找到了「${item.name.zh}」，放进了背包。` : `It found something: ${item.name.en}. It is in your bag.`}
          </p>
        )}
        <p className="small">{lang === "zh" ? "每一刻都是它的大脑在你离开时真实做出的决定，可以在倒带里看。" : "Every moment is what its brain really decided while you were gone; see them all in the rewind."}</p>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            play("tap");
            clear();
          }}
        >
          {lang === "zh" ? "我回来啦" : "Welcome back"}
        </button>
      </motion.div>
    </div>
  );
}
