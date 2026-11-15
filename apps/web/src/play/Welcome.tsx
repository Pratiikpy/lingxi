/**
 * "While you were away" (PRD U4): what really happened during an absence,
 * read from the pet's own replayed log (friends who came by, toys, a fright,
 * and what its brain chose to do), and one small thing it found for the bag.
 * Shown once per absence.
 */

import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HOME, ITEM, ROOMS } from "@lingxi/world";
import { type Frame, type Pet, awayFind, awaySeed, halvesOf, momentText, rewind } from "@lingxi/game";
import { useLang } from "../i18n";
import { programFor, useGame } from "../game/store";
import { useWorld } from "../game/world";
import { play } from "../game/sound";

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
    localStorage.setItem(CLAIMED, key);
  } catch {
    // shown again next time at worst; the find is still given once per visit
  }
}

const clock = (f: Frame, lang: Lang) => (f.at === null ? "" : new Date(f.at).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" }));

export function WelcomeBack({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const away = useGame((s) => s.away);
  const clear = useGame((s) => s.clearAway);
  const receive = useWorld((s) => s.receive);
  const mine = away && away.petKey === String(pet.bornAt) ? away : null;
  const key = mine ? `${mine.petKey}:${mine.to}` : "";

  const story = useMemo(() => {
    if (!mine) return null;
    const frames = rewind(pet, (l) => (pet.family ? { halves: halvesOf(pet.family, l) } : { program: programFor(pet.line, l, pet.instincts ?? 0) }), mine.to - mine.from + 1);
    const window = frames.filter((f) => f.at !== null && f.at >= mine.from * 60_000 && f.at <= mine.to * 60_000);
    const events = window.filter((f) => f.senses.event !== 0).slice(-5);
    const napped = window.some((f) => f.want === 3);
    return { events, napped };
    // the story is read once, when the absence is first shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const find = useMemo(() => (mine ? awayFind(awaySeed(pet), mine.from, mine.to, ROOMS[HOME]?.drops ?? []) : null), [key]);

  const given = useRef(false);
  useEffect(() => {
    if (!mine || given.current || claimed(key)) return;
    given.current = true;
    claim(key);
    if (find !== null) receive(find, 1);
  }, [key]);

  if (!mine || !story) return null;
  const hours = Math.max(1, Math.round((mine.to - mine.from) / 60));
  const item = find !== null ? ITEM[find] : undefined;
  return (
    <div className="fam-modal" role="dialog" aria-modal="true" aria-label={lang === "zh" ? "你不在的时候" : "While you were away"}>
      <motion.div className="fam-card welcome-card" initial={reduce ? false : { y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
        <p className="label">{lang === "zh" ? `你不在的这 ${hours} 小时` : `While you were away · ${hours} ${hours === 1 ? "hour" : "hours"}`}</p>
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
