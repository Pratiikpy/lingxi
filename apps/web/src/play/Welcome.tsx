/**
 * "While you were away" (PRD U4): what really happened during an absence,
 * read from the pet's own replayed log (friends who came by, toys, a fright,
 * and what its brain chose to do), and one small thing it found for the bag.
 * Shown once per absence.
 */

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DECOR_BY_ID, HOME, ITEM, ROOMS } from "@lingxi/world";
import { type Frame, type Pet, type VisitorGift, awayFind, awayNeeds, awaySeed, rewind, ruleSource, schoolIdsOf, stageOf, strongestHabit, tellMoments, visitorsDuring } from "@lingxi/game";
import { VisitorArt, useAlbum } from "./Album";
import { useLang } from "../i18n";
import { mindForPet, useGame } from "../game/store";
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

const LOW: Record<"food" | "joy" | "energy" | "clean", { en: string; zh: string }> = {
  food: { en: "hungry", zh: "饿了" },
  joy: { en: "a little low", zh: "有点闷" },
  energy: { en: "tired", zh: "累了" },
  clean: { en: "dusty", zh: "灰扑扑的" },
};

/** How its needs held up while the player was away (G5): said plainly, never as blame. */
export function needsText(pet: Pick<Pet, "name" | "meters" | "sick" | "hibernating">, lang: Lang): string {
  const n = awayNeeds(pet);
  const list = n.low.map((k) => LOW[k][lang]);
  const join = (xs: string[]) => (lang === "zh" ? xs.join("、") : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
  if (n.kind === "hibernating")
    return lang === "zh" ? `${pet.name}的食物吃完了，沉沉睡着了。喂它或摸摸它就会醒。` : `${pet.name}'s food ran out and it fell into a long sleep. Feed it or give it a pat to wake it.`;
  if (n.kind === "sick") return lang === "zh" ? `好几天没人照顾，${pet.name}生病了。吃药就会好。` : `After days without care, ${pet.name} fell ill. Medicine makes it well.`;
  if (n.kind === "waiting") return lang === "zh" ? `它的需求停在最低处等你回来：现在${join(list)}。` : `Its needs waited for you at their lowest: it is ${join(list)} now.`;
  return lang === "zh" ? `它的需求都还好好的。` : `Its needs held up well.`;
}

/** The card for the last long absence, if it belongs to the pet on screen; one card per absence. */
export function WelcomeBack({ pet }: { pet: Pet }) {
  const away = useGame((s) => s.away);
  const mine = away && away.petKey === String(pet.bornAt) ? away : null;
  if (!mine) return null;
  return <AwayCard key={`${mine.petKey}:${mine.to}`} pet={pet} absence={mine} />;
}

/** Up to five moments: those a taught lesson decided first, then the latest others; each group in time order. */
function leadWithTaught(frames: Frame[]): Frame[] {
  const taught = frames.filter((f) => ruleSource(f) === "taught").slice(-5);
  const rest = frames.filter((f) => ruleSource(f) !== "taught").slice(-(5 - taught.length));
  return [...taught, ...(taught.length < 5 ? rest : [])];
}

/** What happened while the player was away, read once from the pet's log when the absence is first shown. */
/** What a visitor may notice about this pet (G4): the lessons it knows, its habits, its line, stage and form. */
function visitContextOf(pet: Pet, ms: number) {
  const stage = stageOf(pet, ms);
  return { lessons: schoolIdsOf(pet.lessons), traits: pet.traits, line: pet.line, stage, tzOffsetMin: pet.tzOffsetMin, ...(pet.form ? { form: pet.form } : {}) };
}

/** A visitor's keepsake in words (G4). */
function giftText(g: VisitorGift, lang: Lang): string {
  if (g.kind === "coins") return lang === "zh" ? `${g.n} 金币` : `${g.n} coins`;
  if (g.kind === "decor") return DECOR_BY_ID[g.id]?.name[lang] ?? g.id;
  const name = ITEM[g.item]?.name[lang] ?? "?";
  return g.n > 1 ? `${name} ×${g.n}` : name;
}

function report(pet: Pet, absence: { from: number; to: number }) {
  const frames = rewind(pet, mindForPet(pet), absence.to - absence.from + 1);
  const window = frames.filter((f) => f.at !== null && f.at >= absence.from * 60_000 && f.at <= absence.to * 60_000);
  return {
    // the story leads with what the pet's taught lessons chose (G1), then the latest of the rest, five in all
    events: leadWithTaught(window.filter((f) => f.senses.event !== 0)),
    napped: window.some((f) => f.want === 3),
    find: awayFind(awaySeed(pet), absence.from, absence.to, ROOMS[HOME]?.drops ?? []),
    // the travelling pets who came by, for the album (M9)
    visits: visitorsDuring(awaySeed(pet), absence.from, absence.to, visitContextOf(pet, absence.to * 60_000)),
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
  const [kept, setKept] = useState<ReturnType<typeof addVisits>>([]);
  useEffect(() => {
    if (!visits.length) return;
    // adding the visits to the album is a change to the album (once per absence); the keepsakes it gave show after
    const gave = addVisits(key, visits);
    let live = true;
    void Promise.resolve().then(() => live && setKept(gave));
    return () => {
      live = false;
    };
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
        {kept.length > 0 && (
          <ul className="welcome-keepsakes">
            {kept.map((k, i) => (
              <li key={i} className="small">
                {lang === "zh" ? `${k.visitor.name.zh}留下了纪念品：${giftText(k.gift, lang)}。` : `${k.visitor.name.en} left a keepsake: ${giftText(k.gift, lang)}.`}
              </li>
            ))}
          </ul>
        )}
        {story.events.length ? (
          <ul className="welcome-list">
            {/* D18: told together, so no sentence is said twice in one card; a moment past its lines is told without quotes */}
            {tellMoments(story.events, lang, strongestHabit(pet.traits)).map((said, i) => {
              const f = story.events[i]!;
              return (
                <li key={f.index}>
                  <b>{clock(f, lang)}</b> {EVENT_TEXT[f.senses.event]![lang]}
                  {said && <span> {lang === "zh" ? `${pet.name}：` : `${pet.name}: `}“{said}”</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{lang === "zh" ? `一切都很安静。${pet.name}${story.napped ? "睡了一会儿，" : ""}自己玩了一阵。` : `All quiet. ${pet.name}${story.napped ? " napped a while and" : ""} kept itself busy.`}</p>
        )}
        <p className="welcome-needs">{needsText(pet, lang)}</p>
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
