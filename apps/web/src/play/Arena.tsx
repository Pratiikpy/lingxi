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
import { type CoachNote, MAX_HP, type Move, PARTNERS, type Partner, type Pet, type SparResult, coach, fighterOfMind, fighterOfPartner, spar, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { useGame } from "../game/store";
import { useSpar } from "../game/spar";
import { useWorld } from "../game/world";
import { HOME, ROOMS } from "@lingxi/world";
import { play } from "../game/sound";
import { songForHour, useMusic } from "../game/music";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./arena.css";

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

export function ArenaPanel({ pet, challenge, onChallengeTaken }: { pet: Pet; challenge?: Partner | null; onChallengeTaken?: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [fight, setFight] = useState<{ partner: Partner; result: SparResult; cheer: boolean } | null>(null);
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
  if (fight) return <FightView key={fight.result.seed} pet={pet} {...fight} onDone={() => setFight(null)} onRematch={() => start(fight.partner)} />;

  function start(partner: Partner) {
    const stage = stageOf(pet, Date.now());
    const me = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family }, levelOf(stage), pet.brain);
    const them = fighterOfPartner(partner);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    play("tap");
    setFight({ partner, result: spar(me, them, seed, () => [cheer, false]), cheer });
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
  const canvas = useMemo(() => drawPet("gentle", partner.stage, { expression: index === 0 ? "sleepy" : index === 3 ? "proud" : "happy" }), [partner.stage, index]);
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

function FightView({ pet, partner, result, cheer, onDone, onRematch }: { pet: Pet; partner: Partner; result: SparResult; cheer: boolean; onDone: () => void; onRematch: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const finished = shown >= result.rounds.length;
  const round = shown > 0 ? result.rounds[shown - 1]! : null;
  const hp: [number, number] = round ? round.hp : [MAX_HP, MAX_HP];
  const stage = drawn(stageOf(pet, Date.now()));
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
  useEffect(() => {
    if (!finished || settled.current) return;
    settled.current = true;
    const outcome = result.winner === 0 ? "w" : result.winner === 1 ? "l" : "d";
    const first = useSpar.getState().note(partner.id, outcome);
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
  const mine = useMemo(() => drawPet("gentle", stage, { expression: face(0) }), [stage, shown, finished]);
  const theirs = useMemo(() => drawPet("gentle", partner.stage, { expression: face(1) }), [partner.stage, shown, finished]);

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
              <b>{side === 0 ? pet.name : otherName}</b>
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
              <PetArt canvas={side === 0 ? mine : theirs} line={side === 0 ? pet.line : partner.line} scale={4} />
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
      {finished && <Result pet={pet} partner={partner} result={result} reward={reward} onDone={onDone} onRematch={onRematch} />}
    </div>
  );
}

function Result({ pet, partner, result, reward, onDone, onRematch }: { pet: Pet; partner: Partner; result: SparResult; reward: number; onDone: () => void; onRematch: () => void }) {
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
          opponent: fighterOfPartner(partner),
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
      <div className="row">
        <button type="button" className="btn primary" onClick={onRematch}>
          {lang === "zh" ? "再来一场" : "Rematch"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "换个对手" : "Other partners"}
        </button>
      </div>
      <p className="small sp-fp">
        {lang === "zh" ? `回放指纹 ${result.digest} · 种子 ${result.seed}` : `Replay ${result.digest} · seed ${result.seed}`}
      </p>
    </motion.div>
  );
}
