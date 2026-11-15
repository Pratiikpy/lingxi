/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useBadges } from "../game/badges";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type PixelCanvas, boundingBox, drawPet, type Expression } from "@lingxi/art";
import { STARTERS } from "@lingxi/brain";
import { type Challenge, type CoachNote, type DuelPet, type Fighter, MAX_HP, MOVES, type Move, PARTNERS, type Partner, type Pet, type SparResult, TRAITS, coach, dayOf, duel as runDuel, duelFighter, encodeChallenge, encodeResult, fighterOfMind, fighterOfPartner, halvesOf, petCard, rewindFight, ruleSource, spar, stageOf } from "@lingxi/game";
import { linkPrefix } from "../game/links";
import { useDaily } from "../game/daily";
import { programFor, useGame } from "../game/store";
import { Chips } from "./parts";
import { MOVE_NAMES as MOVE_LABEL, WANT_COLORS, decidingChips } from "./ruleText";
import { useLang } from "../i18n";
import { useSpar } from "../game/spar";
import { useWorld } from "../game/world";
import { HOME, ROOMS } from "@lingxi/world";
import { play } from "../game/sound";
import { songForHour, useMusic } from "../game/music";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./arena.css";
import "./rewind.css";

type Lang = "en" | "zh";
const MOVE_NAMES: Record<Move, [string, string]> = {
  tap: ["Tap", "轻拍"],
  snack: ["Snack", "吃点心"],
  pounce: ["Pounce!", "猛扑！"],
  rest: ["Rest", "歇一歇"],
  dodge: ["Dodge", "闪开"],
  guard: ["Guard", "防守"],
  charm: ["Charm", "撒娇"],
  gift: ["Gift", "送礼"],
};
const WIN_COINS = 5;
const FIRST_WIN_COINS = 25;
const ROUND_MS = 950;

const levelOf = (stage: string) => (stage === "elder" ? 2 : stage === "teen" || stage === "adult" ? 1 : 0);
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));

/** A pet sprite cropped to what is drawn, so small pets are not lost in empty canvas. */
function PetArt({ canvas, line, scale, label }: { canvas: PixelCanvas; line: keyof typeof PALETTE_OF; scale: number; label?: string }) {
  const b = boundingBox(canvas);
  const crop = { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(canvas.w - Math.max(0, b.x - 1), b.w + 2), h: Math.min(canvas.h - Math.max(0, b.y - 1), b.h + 2) };
  return <Sprite canvas={canvas} palette={PALETTE_OF[line]} scale={scale} crop={crop} label={label} />;
}

function why(key: CoachNote["key"], name: string, other: string, lang: Lang): string {
  const en: Record<CoachNote["key"], string> = {
    tooPassive: `${other} kept leaving openings, and ${name} didn't take them.`,
    noDefence: `${name} took big hits without guarding.`,
    ranOut: `${name} ran out of energy and had to rest at the worst moments.`,
    noHealing: `${name} stayed hurt instead of eating to recover.`,
    outmatched: `${other} was simply stronger this time.`,
    wellDone: `${name} fought well.`,
  };
  const zh: Record<CoachNote["key"], string> = {
    tooPassive: `${other}好几次露出破绽，${name}都没抓住。`,
    noDefence: `${name}挨了重击却没有防守。`,
    ranOut: `${name}没力气了，只能在最糟的时候休息。`,
    noHealing: `${name}受伤了也没吃东西恢复。`,
    outmatched: `这次${other}就是更强。`,
    wellDone: `${name}打得很好。`,
  };
  return (lang === "zh" ? zh : en)[key];
}

type FightState = { partner: Partner; result: SparResult; cheer: boolean; opponent?: Fighter; duel?: { challenge: Challenge; reply: DuelPet }; daily?: boolean };

/** The pet as it travels in a challenge link: its whole mind, its body, and a few true facts. */
export function duelPetOf(pet: Pet): DuelPet {
  const stage = stageOf(pet, Date.now());
  const nature = [...TRAITS].filter((t) => pet.traits[t] > 0).sort((a, b) => pet.traits[b] - pet.traits[a]).slice(0, 2);
  return {
    name: pet.name,
    line: pet.line,
    stage,
    card: petCard(pet),
    story: { days: dayOf(pet, Date.now()), lessons: pet.lessons.length, nature },
  };
}

/** A challenger from a link, shaped as a sparring partner for the fight screen. */
export function partnerOfDuel(c: Challenge): Partner {
  const p = c.from;
  return {
    id: `friend:duel:${c.id}`,
    name: { en: p.name, zh: p.name },
    line: p.line,
    stage: drawn(p.stage),
    level: p.stage === "elder" ? 2 : p.stage === "teen" || p.stage === "adult" ? 1 : 0,
    blurb: { en: "", zh: "" },
    program: STARTERS[p.line],
  };
}

export function ArenaPanel({ pet, challenge, onChallengeTaken, duel, onDuelTaken }: { pet: Pet; challenge?: Partner | null; onChallengeTaken?: () => void; duel?: Challenge | null; onDuelTaken?: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [fight, setFight] = useState<FightState | null>(null);
  const [link, setLink] = useState("");
  const [cheer, setCheer] = useState(false);
  const fighting = fight !== null;
  useEffect(() => {
    if (!fighting) return;
    useMusic.getState().want("spar");
    return () => useMusic.getState().want(songForHour(new Date().getHours()));
  }, [fighting]);
  useEffect(() => {
    if (!challenge) return;
    start(challenge);
    onChallengeTaken?.();
    // a new challenge starts one fight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);
  useEffect(() => {
    if (!duel) return;
    // a challenge from a link: our pet answers with its own brain, on the challenge's fixed seed
    const reply = duelPetOf(pet);
    play("tap");
    setFight({ partner: partnerOfDuel(duel), result: runDuel(duel, reply), cheer: false, opponent: duelFighter(duel.from), duel: { challenge: duel, reply } });
    onDuelTaken?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel]);
  if (fight) return <FightView key={fight.result.seed} pet={pet} self={{ name: pet.name, line: pet.line, stage: drawn(stageOf(pet, Date.now())) }} {...fight} onDone={() => setFight(null)} onRematch={() => start(fight.partner)} />;

  const makeLink = async () => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    const url = `${linkPrefix("play.html")}duel=${encodeChallenge({ id, from: duelPetOf(pet), at: Date.now() })}`;
    setLink(url);
    play("success");
    try {
      if (navigator.share) await navigator.share({ title: lang === "zh" ? `${pet.name}向你发起切磋` : `${pet.name} challenges your pet`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // the share sheet was dismissed; the link stays on screen to copy
    }
  };

  function start(partner: Partner, daily?: { seed: number }) {
    const stage = stageOf(pet, Date.now());
    const me = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts }, levelOf(stage), pet.brain);
    const them = fighterOfPartner(partner);
    // practice spars roll a private seed; the daily challenge uses the day's block, with no cheering, so it is the same for everyone
    const seed = daily ? daily.seed : crypto.getRandomValues(new Uint32Array(1))[0]!;
    const cheering = daily ? false : cheer;
    play("tap");
    setFight({ partner, result: spar(me, them, seed, () => [cheering, false]), cheer: cheering, ...(daily ? { daily: true } : {}) });
  }

  return (
    <div className="sp-arena">
      <p className="small">
        {lang === "zh"
          ? `${pet.name}的每一招都由它自己的大脑电路决定。你教它的东西，会改变它怎么切磋。`
          : `Every move ${pet.name} makes comes from its own brain circuit. What you teach changes how it spars.`}
      </p>
      <label className="sp-cheer">
        <input type="checkbox" checked={cheer} onChange={(e) => setCheer(e.target.checked)} />
        <span>{lang === "zh" ? "在场边为它加油（它会感觉到你在身边）" : "Cheer from the side (it feels you're there)"}</span>
      </label>
      <div className="sp-duel">
        <button type="button" className="btn primary" onClick={makeLink}>
          {lang === "zh" ? "用链接向朋友发起切磋" : "Challenge a friend by link"}
        </button>
        {link && (
          <>
            <input className="sp-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={lang === "zh" ? "切磋链接" : "Challenge link"} />
            <p className="small">
              {lang === "zh"
                ? `链接里带着${pet.name}现在的大脑和故事。朋友用自己的宠物应战，结果谁都能重放验证。`
                : `The link carries ${pet.name}'s brain and story as they are now. Your friend answers with their own pet, and anyone can replay the result.`}
            </p>
          </>
        )}
      </div>
      <DailyCard pet={pet} onStart={(partner, seed) => start(partner, { seed })} />
      <ul className="sp-partners">
        {PARTNERS.map((p, i) => (
          <PartnerCard key={p.id} partner={p} index={i} lang={lang} onPick={() => start(p)} />
        ))}
      </ul>
    </div>
  );
}

function PartnerCard({ partner, index, lang, onPick }: { partner: Partner; index: number; lang: Lang; onPick: () => void }) {
  const record = useSpar((s) => s.records[partner.id]);
  const canvas = useMemo(() => drawPet(partner.line, partner.stage, { expression: index === 0 ? "sleepy" : index === 3 ? "proud" : "happy" }), [partner.line, partner.stage, index]);
  const stars = index + 1;
  return (
    <li>
      <button type="button" className="sp-partner" onClick={onPick}>
        <span className="sp-portrait">
          <PetArt canvas={canvas} line={partner.line} scale={2} label={partner.name[lang]} />
        </span>
        <span className="sp-who">
          <b>{partner.name[lang]}</b>
          <span className="sp-stars" aria-label={lang === "zh" ? `难度 ${stars}` : `difficulty ${stars} of 4`}>
            {"★".repeat(stars)}
            <i>{"★".repeat(4 - stars)}</i>
          </span>
          <span className="sp-blurb">{partner.blurb[lang]}</span>
        </span>
        <span className="sp-record">
          {record ? (lang === "zh" ? `${record.w}胜 ${record.l}负` : `${record.w}W ${record.l}L`) : lang === "zh" ? "未交手" : "new"}
        </span>
      </button>
    </li>
  );
}

export function FightView({
  pet,
  self,
  partner,
  result,
  cheer,
  opponent,
  duel,
  daily = false,
  replay = false,
  onDone,
  onRematch,
}: FightState & { pet?: Pet; self: { name: string; line: Pet["line"]; stage: PetStage }; replay?: boolean; onDone: () => void; onRematch: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const finished = shown >= result.rounds.length;
  const round = shown > 0 ? result.rounds[shown - 1]! : null;
  const hp: [number, number] = round ? round.hp : [MAX_HP, MAX_HP];
  const stage = self.stage;
  const otherName = partner.name[lang];
  const roomIndex = useWorld((s) => s.world.room);
  const backdrop = (ROOMS[roomIndex] ?? ROOMS[HOME]!).bgs.day;

  useEffect(() => {
    if (finished) return;
    const id = setTimeout(() => {
      const r = result.rounds[shown]!;
      play(r.hits[0] || r.hits[1] ? "pop" : "tap");
      setShown((n) => n + 1);
    }, shown === 0 ? 500 : reduce ? 450 : ROUND_MS);
    return () => clearTimeout(id);
  }, [shown, finished, result, reduce]);

  const settled = useRef(false);
  const [reward, setReward] = useState(0);
  const [dailyNote, setDailyNote] = useState<"best" | "same" | null>(null);
  useEffect(() => {
    if (!finished || settled.current || replay) return;
    settled.current = true;
    const outcome = result.winner === 0 ? "w" : result.winner === 1 ? "l" : "d";
    const first = useSpar.getState().note(partner.id, outcome);
    if (daily) {
      const margin = result.rounds.at(-1) ? result.rounds.at(-1)!.hp[0] - result.rounds.at(-1)!.hp[1] : 0;
      const newBest = useDaily.getState().record(margin, outcome === "w");
      setDailyNote(newBest ? "best" : "same");
    }
    if (outcome === "w") useBadges.getState().note("sparWins");
    if (outcome === "w" && !partner.id.startsWith("friend:")) {
      const coins = WIN_COINS + (first ? FIRST_WIN_COINS : 0);
      useWorld.getState().reward(coins);
      setReward(coins);
      play("success");
    }
  }, [finished, result, partner.id]);

  const face = (side: 0 | 1): Expression => {
    if (finished) return result.winner === side ? "proud" : result.winner === -1 ? "happy" : "sad";
    if (!round) return "neutral";
    if (round.hits[1 - side]! >= 14) return "startled";
    if (round.moves[side] === "rest") return "sleepy";
    if (round.moves[side] === "snack") return "munch";
    if (round.moves[side] === "charm" || round.moves[side] === "gift") return "love";
    return round.moods[side]! >= 2 ? "sparkly" : round.moods[side] === 0 ? "sulk" : "neutral";
  };
  const mine = useMemo(() => drawPet(self.line, stage, { expression: face(0), ...(pet?.form && !replay ? { form: pet.form } : {}) }), [self.line, stage, shown, finished, pet?.form, replay]);
  const theirs = useMemo(() => drawPet(partner.line, partner.stage, { expression: face(1) }), [partner.line, partner.stage, shown, finished]);

  return (
    <div className="sp-fight">
      <div className="sp-head">
        <span>{lang === "zh" ? `第 ${Math.max(1, shown)} / 16 回合` : `Round ${Math.max(1, shown)} of 16`}</span>
        {cheer && <span className="sp-cheering">{lang === "zh" ? "你在加油" : "You're cheering"}</span>}
        {!finished && (
          <button type="button" className="link" onClick={() => setShown(result.rounds.length)}>
            {lang === "zh" ? "跳到结果" : "Skip to result"}
          </button>
        )}
      </div>
      <div className="sp-ring" aria-live="polite" style={{ backgroundImage: `linear-gradient(rgba(255,253,248,0.05), rgba(43,33,64,0.18)), url(${backdrop})` }}>
        {([0, 1] as const).map((side) => (
          <div key={side} className={`sp-fighter side-${side}`}>
            <div className="sp-bar">
              <b>{side === 0 ? self.name : otherName}</b>
              <span className="sp-hp" role="meter" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={hp[side]} aria-label={lang === "zh" ? "体力" : "health"}>
                <i style={{ transform: `scaleX(${hp[side] / MAX_HP})` }} />
              </span>
            </div>
            <motion.div
              key={`${side}-${shown}`}
              className="sp-body"
              animate={round && round.hits[1 - side]! > 0 && !reduce ? { x: [0, side === 0 ? -6 : 6, 0, side === 0 ? -3 : 3, 0] } : round && round.moves[side] === "pounce" && !reduce ? { x: [0, side === 0 ? 14 : -14, 0] } : {}}
              transition={{ duration: 0.38 }}
            >
              <PetArt canvas={side === 0 ? mine : theirs} line={side === 0 ? self.line : partner.line} scale={4} />
            </motion.div>
            <AnimatePresence>
              {round && round.hits[1 - side]! > 0 && (
                <motion.span key={`hit-${shown}`} className="sp-pop" initial={{ opacity: 0, y: 0 }} animate={{ opacity: 1, y: -18 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                  −{round.hits[1 - side]}
                </motion.span>
              )}
            </AnimatePresence>
            <span className="sp-move">{round ? MOVE_NAMES[round.moves[side]!][lang === "zh" ? 1 : 0] : "…"}</span>
          </div>
        ))}
      </div>
      {finished && dailyNote && (
        <p className="sp-daily-note">
          {dailyNote === "best"
            ? lang === "zh"
              ? "这是你今天每日挑战的最好成绩。"
              : "Your best in today's challenge so far."
            : lang === "zh"
              ? "没有超过今天的最好成绩。教它点新东西再试。"
              : "Not better than your best today. Teach it something and try again."}
        </p>
      )}
      {finished && (replay || !pet ? <ReplayResult self={self} partner={partner} result={result} onDone={onDone} /> : <Result pet={pet} partner={partner} result={result} reward={reward} opponent={opponent} duel={duel} onDone={onDone} onRematch={onRematch} />)}
    </div>
  );
}

function Result({ pet, partner, result, reward, opponent, duel, onDone, onRematch }: { pet: Pet; partner: Partner; result: SparResult; reward: number; opponent?: Fighter; duel?: FightState["duel"]; onDone: () => void; onRematch: () => void }) {
  const [backLink, setBackLink] = useState("");
  const lang = useLang((s) => s.lang) as Lang;
  const learn = useGame((s) => s.learn);
  const [note, setNote] = useState<CoachNote | null>(null);
  const [taught, setTaught] = useState<"idle" | "done" | string>("idle");
  // the coach looks at the pet as it was in this fight; teaching afterwards does not re-run it
  const asFought = useRef(pet);
  useEffect(() => {
    const pet = asFought.current;
    if (result.winner === 0) return;
    // the coach runs a few hundred practice spars; let the result paint first
    const id = setTimeout(() => {
      const stage = stageOf(pet, Date.now());
      setNote(
        coach({
          result,
          side: 0,
          line: pet.line,
          stage,
          lessons: pet.lessons,
          level: levelOf(stage),
          memory: pet.brain,
          family: pet.family,
          instincts: pet.instincts,
          opponent: opponent ?? fighterOfPartner(partner),
        }),
      );
    }, 60);
    return () => clearTimeout(id);
  }, [result, partner]);

  const title = result.winner === 0 ? (lang === "zh" ? `${pet.name}赢了！` : `${pet.name} won!`) : result.winner === 1 ? (lang === "zh" ? `${partner.name.zh}赢了` : `${partner.name.en} won`) : lang === "zh" ? "平手" : "A draw";
  return (
    <motion.div className="sp-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <h3>{title}</h3>
      {partner.id.startsWith("friend:") && <p className="small">{lang === "zh" ? "和朋友的友谊赛，不发金币。" : "A friendly match with a friend's pet: no coins."}</p>}
      {reward > 0 && <p className="sp-coins">{lang === "zh" ? `+${reward} 金币` : `+${reward} coins`}</p>}
      {result.winner !== 0 && (
        <div className="sp-coach">
          <p className="label">{lang === "zh" ? "教练说" : "Coach says"}</p>
          {!note && <p className="small">{lang === "zh" ? "教练在看回放……" : "The coach is watching the replay…"}</p>}
          {note && <p>{why(note.key, pet.name, partner.name[lang], lang)}</p>}
          {note?.lesson && (
            <>
              <p>
                {lang === "zh" ? "试着教它：" : "Try teaching it: "}
                <b>{note.lesson.label[lang]}</b>
              </p>
              <p className="small">
                {lang === "zh"
                  ? `在 24 场练习里，这样能赢 ${note.after} 场（现在是 ${note.before} 场）。`
                  : `In 24 practice spars this wins ${note.after} (it wins ${note.before} now).`}
              </p>
              {taught === "done" ? (
                <p className="sp-ok">{lang === "zh" ? "学会了！再来一场试试。" : "Learned! Try a rematch."}</p>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const r = learn(note.lesson!.rule);
                    setTaught(r.ok ? "done" : r.reason);
                  }}
                >
                  {lang === "zh" ? "教它这个" : "Teach this"}
                </button>
              )}
              {taught !== "idle" && taught !== "done" && (
                <p className="small sp-warn">
                  {taught === "full"
                    ? lang === "zh"
                      ? "它现在学不下更多了。长大后能学更多，或者先在心智里忘掉一条。"
                      : "Its mind is full for now. It can hold more as it grows, or forget a lesson in Mind first."
                    : lang === "zh"
                      ? "这条教不进去。"
                      : "That lesson didn't fit."}
                </p>
              )}
            </>
          )}
          {note && !note.lesson && (
            <p className="small">{lang === "zh" ? "现在没有哪条新课能帮上忙，长大一点再来。" : "No new lesson would help right now. Come back when it's grown a little."}</p>
          )}
        </div>
      )}
      {duel && (
        <div className="sp-duel">
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const url = `${linkPrefix("play.html")}duelr=${encodeResult(duel)}`;
              setBackLink(url);
              play("success");
              try {
                if (navigator.share) await navigator.share({ title: lang === "zh" ? "切磋结果" : "Our spar", url });
                else await navigator.clipboard.writeText(url);
              } catch {
                // dismissed; the link stays on screen
              }
            }}
          >
            {lang === "zh" ? `把结果发回给${partner.name.zh}的主人` : `Send the result back to ${partner.name.en}'s owner`}
          </button>
          {backLink && <input className="sp-link" readOnly value={backLink} onFocus={(e) => e.currentTarget.select()} aria-label={lang === "zh" ? "结果链接" : "Result link"} />}
        </div>
      )}
      <div className="row">
        {!duel && (
          <button type="button" className="btn primary" onClick={onRematch}>
            {lang === "zh" ? "再来一场" : "Rematch"}
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "换个对手" : "Other partners"}
        </button>
      </div>
      <p className="small sp-fp">
        {lang === "zh" ? `回放指纹 ${result.digest} · 种子 ${result.seed}` : `Replay ${result.digest} · seed ${result.seed}`}
      </p>
      <FightRewind pet={asFought.current} result={result} />
    </motion.div>
  );
}

const RULE_SOURCE: Record<ReturnType<typeof ruleSource>, { en: string; zh: string }> = {
  taught: { en: "from something you taught it", zh: "来自你教它的" },
  instinct: { en: "from an instinct it hatched with", zh: "来自它天生的本能" },
  born: { en: "from how its egg line is born", zh: "来自它这一系生来就会的" },
  default: { en: "nothing matched, so its default move", zh: "没有条件符合，按默认出招" },
};

/** F11 for spars: scrub the rounds and see which rule of its own brain picked each move. */
function FightRewind({ pet, result }: { pet: Pet; result: SparResult }) {
  const lang = useLang((s) => s.lang) as Lang;
  const why = useMemo(
    () =>
      rewindFight(
        pet.family ? { halves: halvesOf(pet.family, pet.lessons) } : { program: programFor(pet.line, pet.lessons, pet.instincts ?? 0) },
        pet.brain,
        result.rounds.map((r) => r.words[0]),
      ),
    [pet, result],
  );
  const [k, setK] = useState(0);
  if (!why.length) return null;
  const w = why[Math.min(k, why.length - 1)]!;
  const round = result.rounds[Math.min(k, why.length - 1)]!;
  const chips = decidingChips(w.program, w.rule, lang, true);
  const chosen = MOVES[w.want]!;
  const changed = round.moves[0] !== chosen;
  return (
    <div className="sp-why">
      <p className="label">{lang === "zh" ? `回看：${pet.name}每一招为什么这么出` : `Rewind: why ${pet.name} made each move`}</p>
      <div className="sp-why-rounds" role="radiogroup" aria-label={lang === "zh" ? "回合" : "Rounds"}>
        {result.rounds.map((r, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === k}
            aria-label={`${lang === "zh" ? "第" : "Round "}${i + 1}${lang === "zh" ? "回合" : ""}`}
            style={{ background: WANT_COLORS[why[i]!.want] }}
            onClick={() => (play("tap"), setK(i))}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="rw-card">
        <p className="rw-say" style={{ borderColor: WANT_COLORS[w.want] }}>
          {lang === "zh" ? `第 ${k + 1} 回合：${MOVE_LABEL.zh[MOVES.indexOf(round.moves[0])]}` : `Round ${k + 1}: ${MOVE_LABEL.en[MOVES.indexOf(round.moves[0])]}`}
          {changed && (
            <span>
              {lang === "zh"
                ? `它的大脑选了${MOVE_LABEL.zh[w.want]}，但${round.moves[0] === "rest" ? "没力气了，只能休息" : "扑空了，变成轻拍"}。`
                : `Its brain chose ${MOVE_LABEL.en[w.want]}, but ${round.moves[0] === "rest" ? "it had no stamina left, so it rested" : "the pounce slipped into a tap"}.`}
            </span>
          )}
        </p>
        <div className="rw-rule">
          <Chips when={chips.when} then={chips.then} want={chips.want} />
          <small>{RULE_SOURCE[ruleSource(w)][lang]}</small>
        </div>
      </div>
    </div>
  );
}

/** The end of a replayed fight (from a result link): who won, and the fingerprint anyone can check. */
function ReplayResult({ self, partner, result, onDone }: { self: { name: string }; partner: Partner; result: SparResult; onDone: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const title = result.winner === 0 ? (lang === "zh" ? `${self.name}赢了` : `${self.name} won`) : result.winner === 1 ? (lang === "zh" ? `${partner.name.zh}赢了` : `${partner.name.en} won`) : lang === "zh" ? "平手" : "A draw";
  return (
    <motion.div className="sp-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <h3>{title}</h3>
      <p className="small">
        {lang === "zh"
          ? "这场切磋是在你的浏览器里，用链接里两只宠物的大脑重新算出来的。指纹一样，就是同一场。"
          : "This spar was just recomputed in your browser from both pets' brains in the link. The same fingerprint means the same fight."}
      </p>
      <p className="small sp-fp">{lang === "zh" ? `回放指纹 ${result.digest} · 种子 ${result.seed}` : `Replay ${result.digest} · seed ${result.seed}`}</p>
      <div className="row">
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "关闭" : "Close"}
        </button>
      </div>
    </motion.div>
  );
}

/** Today's challenge: the same partner and the same seed for everyone, the seed from X Layer (PRD F19, F22). */
function DailyCard({ pet, onStart }: { pet: Pet; onStart: (partner: Partner, seed: number) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { status, block, seed, partnerIndex, best, load } = useDaily();
  useEffect(() => {
    void load();
  }, [load]);
  const partner = PARTNERS[partnerIndex]!;
  const art = useMemo(() => drawPet(partner.line, partner.stage, { expression: "proud" }), [partner.line, partner.stage]);
  return (
    <section className="sp-daily" aria-label={lang === "zh" ? "每日挑战" : "Daily challenge"}>
      <span className="sp-portrait">
        <PetArt canvas={art} line={partner.line} scale={2} label={partner.name[lang]} />
      </span>
      <div className="sp-daily-text">
        <p className="label">{lang === "zh" ? "今日挑战 · 所有人同一场" : "Today's challenge · the same fight for everyone"}</p>
        <b>{lang === "zh" ? `${pet.name} 对 ${partner.name.zh}` : `${pet.name} vs ${partner.name.en}`}</b>
        <span className="small">
          {status === "ready" && block ? (
            <>
              {lang === "zh" ? "种子来自今天 X Layer 的第一个区块 " : "Seed from today's first X Layer block "}
              <a href={`https://www.oklink.com/xlayer/block/${block.block}`} target="_blank" rel="noopener noreferrer">
                #{block.block}
              </a>
            </>
          ) : status === "error" ? (
            lang === "zh" ? "暂时连不上 X Layer，过一会儿再试。" : "X Layer can't be reached right now; try again in a moment."
          ) : lang === "zh" ? (
            "正在从 X Layer 读取今天的种子……"
          ) : (
            "Reading today's seed from X Layer…"
          )}
        </span>
        {best && (
          <span className="small">
            {lang === "zh" ? `今天最好：${best.won ? "赢了" : "没赢"}，血量差 ${best.margin}` : `Today's best: ${best.won ? "a win" : "not a win yet"}, health margin ${best.margin}`}
          </span>
        )}
      </div>
      {status === "error" ? (
        <button type="button" className="btn" onClick={() => void load()}>
          {lang === "zh" ? "重试" : "Retry"}
        </button>
      ) : (
        <button type="button" className="btn primary" disabled={status !== "ready" || seed === null} onClick={() => seed !== null && onStart(partner, seed)}>
          {lang === "zh" ? "挑战" : "Spar"}
        </button>
      )}
    </section>
  );
}
