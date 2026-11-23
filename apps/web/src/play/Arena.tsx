/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useBadges } from "../game/badges";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FLY, type OverlayPixel, type Palette, type PixelCanvas, boundingBox, drawFly, drawPet, type Expression, type Outfit, wearOverlay } from "@lingxi/art";
import { PAID_SPARS_PER_DAY, outfitOf, paidSparsLeft } from "@lingxi/world";
import { STARTERS, chipName, programOfChips } from "@lingxi/brain";
import { DESIGNED_PARTNERS, composeProgram, type Challenge, type CoachNote, type DuelPet, type Fighter, MAX_HP, MOVES, type Move, PARTNERS, type Partner, type Pet, type SparResult, type SparVersion, CURRENT_SPAR, dailySparVersion, rulesOf, fight as fightSpar, TRAITS, coach, dayOf, duel as runDuel, duelFighter, encodeChallenge, encodeResult, fighterOfMind, fighterOfPartner, halvesOf, petCard, rewindFight, ruleSource, stageOf, type Exchange, type Mind, PRACTICE_SEEDS, SPAR_PUNISH, duelPetMind, exchangesOf, partnerMind, FLY_RIVALS, type FlyRival, FlyLinkError, flyFighter, parseFlyBrain, skillRules, sparMods } from "@lingxi/game";
import { linkPrefix } from "../game/links";
import { LILAC, MINT, PEACH, SILICON } from "@lingxi/art";
import { BEHEMOTH_LEVEL, BEHEMOTH_STEPS_PER_ROUND, SPAR_FIRST_ROUND_MS, SPAR_FIRST_WIN_COINS, SPAR_ROUND_MS, SPAR_WIN_COINS, behemothAt, behemothFighter } from "@lingxi/game";
import { now } from "../game/gameClock";

const BEHEMOTH_PARTNER: Partner = { id: "builder:behemoth", name: { en: "Behemoth", zh: "巨兽" }, look: "behemoth", line: "gentle", stage: "adult", level: BEHEMOTH_LEVEL, blurb: { en: "", zh: "" }, program: STARTERS.gentle };
import { useDaily } from "../game/daily";
import { programFor, useGame } from "../game/store";
import { Chips } from "./parts";
import { type Profile, fighterOf, flySource, readCircuit, useAdopted } from "../game/adopt";
import { deployment } from "../game/chain";
import type { OutsideCircuit } from "@lingxi/chain";
import { MOVE_NAMES as MOVE_LABEL, MOVE_WORDS, WANT_COLORS, chipsFor, decidingChips } from "./ruleText";
import { useLang } from "../i18n";
import { useSpar } from "../game/spar";
import { useWorld } from "../game/world";
import { HOME, ROOMS } from "@lingxi/world";
import { play } from "../game/sound";
import { songForHour, useMusic } from "../game/music";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { Sprite } from "./Sprite";
import "./arena.css";
import "./rewind.css";
import { RunCard, RunView } from "./ArenaRun";
import { checkSparOnChain } from "../game/battleCheck";
import { ChainCheck } from "./ChainCheck";
import { SeasonCard } from "./Season";
import { noteEvent, noteTally, questSlots } from "../game/tally";
import { markLoss } from "../game/comfort";
import { linkToken } from "../game/duelLinks";

/** A pet in a replay, or with nothing on: one shared empty outfit, so its drawing is not redone each round. */
const NO_OUTFIT: Outfit = {};

type Lang = "en" | "zh";
const MOVE_NAMES: Record<Move, [string, string]> = MOVE_WORDS;

const levelOf = (stage: string) => (stage === "elder" ? 2 : stage === "teen" || stage === "adult" ? 1 : 0);
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));

/** A pet sprite cropped to what is drawn, so small pets are not lost in empty canvas. */
/** A partner's own colouring, when it has one (B7). */
const COLOURS = { lilac: LILAC, mint: MINT, peach: PEACH } as const;
const coloursOf = (p: Partner): Palette | undefined => (p.colours ? COLOURS[p.colours] : undefined);

function PetArt({ canvas, line, palette, scale, label, overlay }: { canvas: PixelCanvas; line: keyof typeof PALETTE_OF; palette?: Palette; scale: number; label?: string; overlay?: readonly OverlayPixel[] }) {
  const b = boundingBox(canvas);
  const crop = { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(canvas.w - Math.max(0, b.x - 1), b.w + 2), h: Math.min(canvas.h - Math.max(0, b.y - 1), b.h + 2) };
  return <Sprite canvas={canvas} palette={palette ?? PALETTE_OF[line]} scale={scale} crop={crop} label={label} overlay={overlay} />;
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

type FightState = {
  partner: Partner;
  result: SparResult;
  cheer: boolean;
  opponent?: Fighter;
  duel?: { challenge: Challenge; reply: DuelPet; version: SparVersion };
  daily?: boolean;
  /** the adopted brain the pet fought with, if not its own */
  instinct?: string;
  /** item bonuses spent on this spar (plan 4.5): coins paid even if it is lost */
  boostCoins?: number;
  boosted?: boolean;
};

/** A fight on the spar screen; `again`: the same fight shown once more as a replay, nothing paid or recorded twice. */
type ArenaFight = FightState & { again?: boolean };

/**
 * The fight on the spar screen. It is kept outside the panel so whatever starts a fight (a partner picked on the
 * screen, a friend's card arriving, a duel link accepted, Behemoth's card) starts it in that same event, and the
 * screen opens onto it; closing the screen ends it, as the screen's own state would.
 */
export const useArena = create<{ fight: ArenaFight | null }>(() => ({ fight: null }));

/** Behemoth, as a sparring partner; its moves come from its own CPU (`behemothFighter`). */
export const BEHEMOTH = { partner: BEHEMOTH_PARTNER, opponent: () => behemothFighter(BEHEMOTH_PARTNER.name.en) };

/**
 * Starts a fight for `pet` against `partner`, with the pet as it is at this moment: spends the bonuses readied from
 * the bag on a practice spar (never on the shared daily challenge), rolls a practice spar's seed, and shows the fight.
 */
export function startFight(pet: Pet, partner: Partner, o: { daily?: { seed: number; day: number }; opponent?: Fighter; cheer?: boolean } = {}): void {
  const { daily, opponent } = o;
  const stage = stageOf(pet, now());
  const own = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts, outside: pet.outside, growth: pet.growth }, levelOf(stage), pet.brain);
  // the daily challenge is the same fight for everyone, so it is always fought with the pet's own mind
  const adopted = useAdopted.getState().byPet[String(pet.bornAt)];
  const me = !daily && adopted?.on ? fighterOf(adopted, pet.name, levelOf(stage)) : own;
  // the daily challenge switches version on a set day; a partner fights with its brain for that version (B3b)
  const version = daily ? dailySparVersion(daily.day) : CURRENT_SPAR;
  const them = opponent ?? fighterOfPartner(partner, version);
  // practice spars roll a private seed; the daily challenge uses the day's block, with no cheering, so it is the same for everyone
  const seed = daily ? daily.seed : crypto.getRandomValues(new Uint32Array(1))[0]!;
  const cheering = daily ? false : (o.cheer ?? false);
  // bonuses readied from the bag (a Wild Jewel, a tonic) are spent on the next practice spar; never on the shared daily
  const boost = daily ? { power: 0, hp: 0, lossCoins: 0 } : useWorld.getState().spendSparBuffs();
  const boosted = boost.power > 0 || boost.hp > 0;
  // D14: from LX-SPAR/4 a bag bonus is applied at face value ("+15 health" is 15 health); earlier versions folded it into
  // the skills, where it all but vanished
  const fighter: Fighter = !boosted
    ? me
    : rulesOf(version)?.boostAtFaceValue
      ? { ...me, boost: { hp: boost.hp, power: boost.power } }
      : { ...me, mods: { stamina: 0, guard: 0, dodge: 0, heal: 0, ...me.mods, power: (me.mods?.power ?? 0) + boost.power, hp: (me.mods?.hp ?? 0) + boost.hp } };
  play("tap");
  useArena.setState({
    fight: {
      partner,
      // the daily challenge switches version on a set day, so one day is one fight for everyone; practice uses today's
      result: fightSpar(version, fighter, them, seed, () => [cheering, false]),
      cheer: cheering,
      ...(opponent ? { opponent } : {}),
      ...(daily ? { daily: true } : {}),
      ...(me !== own && adopted ? { instinct: adopted.name } : {}),
      ...(boost.lossCoins ? { boostCoins: boost.lossCoins } : {}),
      ...(boosted || boost.lossCoins ? { boosted: true } : {}),
    },
  });
}

/** Answers a challenge from a link: our pet, as it is now, replies with its own brain on the challenge's fixed seed. */
export function startDuel(pet: Pet, d: Challenge): void {
  const reply = duelPetOf(pet);
  play("tap");
  const result = runDuel(d, reply);
  useArena.setState({ fight: { partner: partnerOfDuel(d), result, cheer: false, opponent: duelFighter(d.from), duel: { challenge: d, reply, version: result.version } } });
}

/** The pet as it travels in a challenge link: its whole mind, its body, and a few true facts. */
export function duelPetOf(pet: Pet): DuelPet {
  const stage = stageOf(pet, now());
  const nature = [...TRAITS].filter((t) => pet.traits[t] > 0).sort((a, b) => pet.traits[b] - pet.traits[a]).slice(0, 2);
  return {
    name: pet.name,
    line: pet.line,
    stage,
    card: petCard(pet),
    story: { days: dayOf(pet, now()), lessons: pet.lessons.length, nature },
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

export function ArenaPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const fight = useArena((s) => s.fight);
  const setFight = (f: ArenaFight | null) => useArena.setState({ fight: f });
  const [link, setLink] = useState("");
  const [cheer, setCheer] = useState(false);
  const [running, setRunning] = useState(false);
  const fighting = fight !== null || running;
  const paidLeft = useWorld((s) => paidSparsLeft(s.world, now()));
  useEffect(() => {
    if (!fighting) return;
    useMusic.getState().want("spar");
    return () => useMusic.getState().want(songForHour(new Date(now()).getHours()));
  }, [fighting]);
  const start = (partner: Partner, daily?: { seed: number; day: number }, opponent?: Fighter) => startFight(pet, partner, { ...(daily ? { daily } : {}), ...(opponent ? { opponent } : {}), cheer });
  if (running) return <RunView pet={pet} onClose={() => setRunning(false)} />;
  if (fight) {
    const { again, ...shown } = fight;
    return (
      <FightView
        key={`${fight.result.seed}${again ? ":again" : ""}`}
        pet={pet}
        self={{ name: pet.name, line: pet.line, stage: drawn(stageOf(pet, now())) }}
        {...shown}
        replay={again}
        onDone={() => setFight(null)}
        onRematch={() => start(fight.partner, undefined, fight.opponent)}
        onWatchAgain={() => setFight({ ...fight, again: true })}
      />
    );
  }

  const makeLink = async () => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    // a short link when the live server keeps the challenge, the whole code when there is none (A32)
    const url = `${linkPrefix("play.html")}duel=${await linkToken(encodeChallenge({ id, from: duelPetOf(pet), at: now() }))}`;
    setLink(url);
    play("success");
    try {
      if (navigator.share) await navigator.share({ title: lang === "zh" ? `${pet.name}向你发起切磋` : `${pet.name} challenges your pet`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // the share sheet was dismissed; the link stays on screen to copy
    }
  };

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
      <RunCard onOpen={() => setRunning(true)} />
      <DailyCard pet={pet} onStart={(partner, seed, day) => start(partner, { seed, day })} />
      <SeasonCard pet={pet} />
      <section className="sp-behemoth" aria-label={lang === "zh" ? "战胜巨兽" : "Beat the Behemoth"}>
        <div>
          <p className="label">{lang === "zh" ? "建设者小巷 · 战胜巨兽" : "Builders' Lane · Beat the Behemoth"}</p>
          <p className="small">
            {lang === "zh"
              ? "巨兽不看你出什么。每一回合，创始人那台 4 位处理器走九步，累加器低三位的灯决定它的招式。每次都是同一套，所以可以教你的宠物读懂它。"
              : "Behemoth doesn't look at the fight. Each round the founder's 4-bit CPU runs nine steps, and the three low lamps of its accumulator pick the move. It is the same every time, so your pet can be taught to read it."}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => start(BEHEMOTH.partner, undefined, BEHEMOTH.opponent())}>
          {lang === "zh" ? "切磋" : "Spar"}
        </button>
      </section>
      <p className="small sp-purse" role="status">
        {paidLeft > 0
          ? lang === "zh"
            ? `今天还有 ${paidLeft}/${PAID_SPARS_PER_DAY} 场有奖切磋：赢了（或技能保底的输）就发金币。之后的切磋是练习，不限次数，照样算任务和徽章。`
            : `${paidLeft} of ${PAID_SPARS_PER_DAY} paid spars left today: a win (or a loss a skill pays for) earns coins. After that, spars are free practice, as many as you like, and still count for quests and badges.`
          : lang === "zh"
            ? `今天 ${PAID_SPARS_PER_DAY} 场有奖切磋已经用完。现在切磋是练习：不发金币，任务、徽章和战绩照样算。明天再发。`
            : `Today's ${PAID_SPARS_PER_DAY} paid spars are used. Spars now are practice: no coins, but quests, badges and the record still count. More pay tomorrow.`}
      </p>
      <ul className="sp-partners">
        {PARTNERS.map((p, i) => (
          <PartnerCard key={p.id} partner={p} index={i} lang={lang} onPick={() => start(p)} />
        ))}
      </ul>
      <DesignedPartners onPick={(p) => start(p)} />
      <FlyBrains pet={pet} onFight={(partner, opponent) => start(partner, undefined, opponent)} />
    </div>
  );
}

const STAGE_INDEX: Record<string, number> = { baby: 0, child: 1, teen: 2, adult: 3 };
const LINE_ZH: Record<string, string> = { gentle: "温柔", bold: "勇敢", curious: "好奇" };

/** F27: partners whose brains were evolved by search, one per stage, each shown with how it was made and a way to beat it. */
function DesignedPartners({ onPick }: { onPick: (p: Partner) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [hint, setHint] = useState<string | null>(null);
  return (
    <section className="sp-designed" aria-label={L("Designed by search", "由搜索设计")}>
      <p className="label">{L("Designed by search", "由搜索设计")}</p>
      <p className="small">
        {L(
          "These brains were not written by hand. A search evolved each one against the partners above, the three starter brains and the earlier designs, inside the gate budget a pet of that stage has. One was kept only if a pet of that stage can be taught to beat it.",
          "这些大脑不是手写的。搜索让每一个在上面的陪练、三种初始大脑和之前设计出的对手之间不断进化，并且不超过同阶段宠物的门数预算。只有同阶段的宠物能学会打败它的，才会被留下。",
        )}
      </p>
      <ul className="sp-partners">
        {DESIGNED_PARTNERS.map((p) => {
          const d = p.design;
          const open = hint === p.id;
          return (
            <li key={p.id} className="sp-designed-item">
              <PartnerCard partner={p} index={STAGE_INDEX[p.stage] ?? 0} lang={lang} onPick={() => onPick(p)} inItem />
              <p className="small sp-designed-facts">
                {L(
                  `${d.gates} gates · ${d.generations} generations · won ${Math.round(d.test * 100)}% of its test fights`,
                  `${d.gates} 个门 · 进化 ${d.generations} 代 · 测试对局胜率 ${Math.round(d.test * 100)}%`,
                )}{" "}
                <button type="button" className="sp-hint-btn" aria-expanded={open} onClick={() => (play("tap"), setHint(open ? null : p.id))}>
                  {open ? L("Hide the way to beat it", "收起打败它的方法") : L("A way to beat it", "打败它的方法")}
                </button>
              </p>
              {open && (
                <div className="sp-hint">
                  <p className="small">
                    {L(
                      `A ${d.counter.line} pet taught ${d.counter.lessons.length === 1 ? "this lesson" : `these ${d.counter.lessons.length} lessons`} won ${Math.round(d.counter.wins * 100)}% of its fights against ${p.name.en}:`,
                      `学了${d.counter.lessons.length === 1 ? "这一课" : `这 ${d.counter.lessons.length} 课`}的${LINE_ZH[d.counter.line]}宠物，和${p.name.zh}对打赢了 ${Math.round(d.counter.wins * 100)}%：`,
                    )}
                  </p>
                  {d.counter.lessons.map((r, i) => {
                    const c = chipsFor(composeProgram(d.counter.line, d.counter.lessons), r, lang, true);
                    return (
                      <div key={i} className="sp-hint-lesson">
                        <span className="small">{L(`Lesson ${i + 1}`, `第 ${i + 1} 课`)}</span>
                        <Chips when={c.when} then={c.then} want={c.want} />
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A1b: brains written for TapeFly's brawl, run as the same NAND circuits TapeFly compiles. */
function FlyBrains({ pet, onFight }: { pet: Pet; onFight: (partner: Partner, opponent: Fighter) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const art = useMemo(() => drawFly(), []);
  const asPartner = (id: string, name: string, blurb: { en: string; zh: string }): Partner => ({ id: `fly:${id}`, name: { en: name, zh: name }, look: "fly", line: "curious", stage: "baby", level: 1, blurb, program: STARTERS.curious });
  const adopt = useAdopted((s) => s.adopt);
  const fightRival = (r: FlyRival) => onFight(asPartner(r.id, r.name, { en: r.chips.map((c) => chipName(c, "en")).join(" → "), zh: r.chips.map((c) => chipName(c, "zh")).join(" → ") }), flyFighter(r.name, programOfChips(r.chips), 1));
  const fightLink = () => {
    try {
      const program = parseFlyBrain(text);
      setErr("");
      onFight(asPartner("link", L("TapeFly brain", "TapeFly 大脑"), { en: "", zh: "" }), flyFighter(L("TapeFly brain", "TapeFly 大脑"), program, 1));
    } catch (e) {
      play("error");
      setErr(e instanceof FlyLinkError ? L("That isn't a TapeFly brain. Paste a brawl link with program= or chips=, a p1. code, or chips like block,bite.", "这不是 TapeFly 的大脑。请粘贴带 program= 或 chips= 的大乱斗链接、p1. 开头的代码，或像 block,bite 这样的芯片列表。") : String(e));
    }
  };
  return (
    <section className="sp-fly" aria-label={L("TapeFly brains", "TapeFly 大脑")}>
      <div className="sp-fly-head">
        <span className="sp-portrait">
          <PetArt canvas={art} line="curious" palette={FLY} scale={2} />
        </span>
        <div>
          <p className="label">{L("Brains from TapeFly · DUEL-12x3/1", "来自 TapeFly 的大脑 · DUEL-12x3/1")}</p>
          <p className="small">
            {L(
              "TapeFly's brawl is another game built on TapeOut. Its fly brains are 12-in, 3-out NAND circuits; here they are compiled exactly as TapeFly compiles them and fight your pet through the same interface.",
              "TapeFly 的大乱斗是另一款建在 TapeOut 上的游戏。它的果蝇大脑是 12 进 3 出的 NAND 电路；这里按 TapeFly 一模一样的方式编译，并通过同一个接口和你的宠物切磋。",
            )}
          </p>
        </div>
      </div>
      <ul className="sp-fly-ladder">
        {FLY_RIVALS.map((r) => (
          <li key={r.id}>
            <button type="button" className="sp-fly-rival" onClick={() => fightRival(r)}>
              <b>{r.name}</b>
              <span className="small">{r.chips.length === 1 ? chipName(r.chips[0]!, lang === "zh" ? "zh" : "en") : `${r.chips.length} ${L("chips", "张芯片")}`}</span>
              <span className="small sp-fly-gates">{L(`${flyFighter(r.name, programOfChips(r.chips)).gates} gates`, `${flyFighter(r.name, programOfChips(r.chips)).gates} 个门`)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="sp-fly-link"
        onSubmit={(e) => {
          e.preventDefault();
          fightLink();
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={L("Paste a TapeFly brawl link or p1. code", "粘贴 TapeFly 大乱斗链接或 p1. 代码")} aria-label={L("TapeFly brain link", "TapeFly 大脑链接")} />
        <button type="submit" className="btn" disabled={!text.trim()}>
          {L("Spar it", "切磋")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!text.trim()}
          onClick={() => {
            try {
              const program = parseFlyBrain(text);
              setErr("");
              let from = L("a player on TapeFly", "TapeFly 上的一位玩家");
              try {
                if (/^https?:/i.test(text.trim())) from = new URL(text.trim()).host;
              } catch {
                // not a link: a p1. code or chips
              }
              adopt(pet.bornAt, { name: L("TapeFly brain", "TapeFly 大脑"), author: from, profile: "DUEL-12x3/1", gates: flyFighter("x", program).gates, source: flySource(program) });
              play("success");
            } catch {
              play("error");
              setErr(L("That isn't a TapeFly brain. Paste a brawl link with program= or chips=, a p1. code, or chips like block,bite.", "这不是 TapeFly 的大脑。请粘贴带 program= 或 chips= 的大乱斗链接、p1. 开头的代码，或像 block,bite 这样的芯片列表。"));
            }
          }}
        >
          {L("Adopt it", "收养")}
        </button>
      </form>
      {err && (
        <p className="small sp-warn" role="alert">
          {err}
        </p>
      )}
      <ChainBrain pet={pet} onFight={onFight} />
      <AdoptedCard pet={pet} />
    </section>
  );
}

const DEFAULT_PROCESSOR = (deployment?.processor as string | undefined) ?? "";
const READ_ERR: Record<string, { en: string; zh: string }> = {
  notProcessor: { en: "That address isn't a TapeOut processor registered on X Layer.", zh: "这个地址不是 X Layer 上注册的 TapeOut 处理器。" },
  noCircuit: { en: "No circuit with that number on that processor.", zh: "这个处理器上没有这个编号的电路。" },
  tooDeep: { en: "That circuit nests other circuits too deeply to carry.", zh: "这个电路一层套一层，太深了，带不动。" },
  tooBig: { en: "That circuit is too big for a pet to carry on a phone.", zh: "这个电路太大了，宠物在手机上带不动。" },
  illFormed: { en: "That circuit's bytes don't read as a TapeOut netlist.", zh: "这个电路的字节读不成 TapeOut 网表。" },
  pins: { en: "Its pins don't fit a fight: it needs TapeFly's 12 in and 3 out, or a pet's 16 in and 8 out.", zh: "它的引脚接不上切磋：需要 TapeFly 的 12 进 3 出，或宠物的 16 进 8 出。" },
  offline: { en: "X Layer can't be reached right now; try again in a moment.", zh: "暂时连不上 X Layer，请稍后再试。" },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Z7: any circuit on X Layer by processor and number, as a sparring partner or an adopted instinct. */
function ChainBrain({ pet, onFight }: { pet: Pet; onFight: (partner: Partner, opponent: Fighter) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const adopt = useAdopted((s) => s.adopt);
  const [processor, setProcessor] = useState(DEFAULT_PROCESSOR);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<{ circuit: OutsideCircuit; profile: Profile } | null>(null);
  const [err, setErr] = useState("");
  const name = (c: OutsideCircuit) => L(`Circuit #${c.id}`, `#${c.id} 号电路`);
  const asPartner = (c: OutsideCircuit): Partner => ({ id: `chain:${c.processor}:${c.id}`, name: { en: `Circuit #${c.id}`, zh: `#${c.id} 号电路` }, line: "curious", stage: "adult", level: 1, blurb: { en: "", zh: "" }, program: STARTERS.curious });
  const sourceOf = (c: OutsideCircuit) => ({ kind: "chain" as const, processor: c.processor, id: c.id, parts: c.parts });
  return (
    <div className="sp-chain">
      <p className="label">{L("A circuit on X Layer", "X Layer 上的电路")}</p>
      <p className="small">
        {L(
          "Any brain taped out on a TapeOut processor whose pins fit a fight: TapeFly's brawl format, or a pet's. Its maker is credited.",
          "任何在 TapeOut 处理器上流片、引脚接得上切磋的大脑：TapeFly 的大乱斗格式，或宠物的格式。会注明作者。",
        )}
      </p>
      <form
        className="sp-chain-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          setGot(null);
          const r = await readCircuit(processor.trim(), id.trim());
          setBusy(false);
          if (r.ok) setGot({ circuit: r.circuit, profile: r.profile });
          else {
            play("error");
            setErr(READ_ERR[r.reason]![lang]);
          }
        }}
      >
        <input value={processor} onChange={(e) => setProcessor(e.target.value)} placeholder="0x…" aria-label={L("Processor address", "处理器地址")} spellCheck={false} />
        <input value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} placeholder={L("circuit #", "电路编号")} inputMode="numeric" aria-label={L("Circuit number", "电路编号")} />
        <button type="submit" className="btn" disabled={busy || !id || !processor}>
          {busy ? L("Reading…", "读取中……") : L("Read it", "读取")}
        </button>
      </form>
      {err && (
        <p className="small sp-warn" role="alert">
          {err}
        </p>
      )}
      {got && (
        <div className="sp-chain-got">
          <p className="small">
            <b>{name(got.circuit)}</b> · {got.profile === "DUEL-12x3/1" ? L("TapeFly brawl pins", "TapeFly 大乱斗引脚") : L("pet pins", "宠物引脚")} · {L(`${got.circuit.gates} gates`, `${got.circuit.gates} 个门`)}
            {got.circuit.nState ? L(` · ${got.circuit.nState} memory bits`, ` · ${got.circuit.nState} 位记忆`) : ""}
            {got.circuit.parts.length > 1 ? L(` · uses ${got.circuit.parts.length - 1} other circuits`, ` · 引用了 ${got.circuit.parts.length - 1} 个别的电路`) : ""}
            <br />
            {L("Made by ", "作者 ")}
            {got.circuit.owner ? short(got.circuit.owner) : L("unknown", "未知")}
          </p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => onFight(asPartner(got.circuit), fighterOf({ source: sourceOf(got.circuit), profile: got.profile }, name(got.circuit), 1))}>
              {L("Spar against it", "和它切磋")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                adopt(pet.bornAt, { name: name(got.circuit), author: got.circuit.owner, profile: got.profile, gates: got.circuit.gates, source: sourceOf(got.circuit) });
                play("success");
              }}
            >
              {L(`Adopt as ${pet.name}'s fighting instinct`, `收养为${pet.name}的战斗本能`)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The adopted instinct, with its credit, a switch, and a way to let it go. */
function AdoptedCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const a = useAdopted((s) => s.byPet[String(pet.bornAt)]);
  const setOn = useAdopted((s) => s.setOn);
  const drop = useAdopted((s) => s.drop);
  if (!a) return null;
  const by = /^0x[0-9a-fA-F]{40}$/.test(a.author) ? short(a.author) : a.author;
  return (
    <div className="sp-adopted" role="status">
      <p className="small">
        <b>{L(`${pet.name}'s fighting instinct: ${a.name}`, `${pet.name}的战斗本能：${a.name}`)}</b>
        <br />
        {L(`Made by ${by}`, `作者 ${by}`)}
        {a.source.kind === "chain" ? L(` · circuit #${a.source.id} on ${short(a.source.processor)}`, ` · ${short(a.source.processor)} 上的 #${a.source.id} 号电路`) : ""} · {L(`${a.gates} gates`, `${a.gates} 个门`)}
      </p>
      <p className="small">
        {L(
          `While it is on, ${pet.name} fights practice spars with this brain. The daily challenge, seasons and duel links always use ${pet.name}'s own mind, so anyone can replay them.`,
          `打开时，${pet.name}在练习切磋里用这个大脑。每日挑战、赛季和链接切磋一直用${pet.name}自己的心智，这样谁都能重放。`,
        )}
      </p>
      <div className="row">
        <label className="sp-cheer">
          <input type="checkbox" checked={a.on} onChange={(e) => (play("tap"), setOn(pet.bornAt, e.target.checked))} />
          <span>{L("Use it in practice spars", "在练习切磋里使用")}</span>
        </label>
        <button type="button" className="btn" onClick={() => (play("tap"), drop(pet.bornAt))}>
          {L("Let it go", "放下它")}
        </button>
      </div>
    </div>
  );
}


/** A partner to pick; `inItem` when it sits inside a list item of its own (the designed partners), so no list item nests in another. */
function PartnerCard({ partner, index, lang, onPick, inItem = false }: { partner: Partner; index: number; lang: Lang; onPick: () => void; inItem?: boolean }) {
  const record = useSpar((s) => s.records[partner.id]);
  const canvas = useMemo(() => drawPet(partner.line, partner.stage, { expression: index === 0 ? "sleepy" : index === 3 ? "proud" : "happy" }), [partner.line, partner.stage, index]);
  const stars = index + 1;
  const Wrap = inItem ? "div" : "li";
  return (
    <Wrap>
      <button type="button" className="sp-partner" onClick={onPick}>
        <span className="sp-portrait">
          <PetArt canvas={canvas} line={partner.line} palette={coloursOf(partner)} scale={2} label={partner.name[lang]} />
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
    </Wrap>
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
  instinct,
  boostCoins = 0,
  boosted = false,
  onDone,
  onRematch,
  onWatchAgain,
}: FightState & { pet?: Pet; self: { name: string; line: Pet["line"]; stage: PetStage }; replay?: boolean; onDone: () => void; onRematch: () => void; onWatchAgain?: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const finished = shown >= result.rounds.length;
  const round = shown > 0 ? result.rounds[shown - 1]! : null;
  // each side's own full health (a skill or a bag item can make it more than MAX_HP), so the bar never runs past its end
  const full: [number, number] = result.maxHp ?? [MAX_HP, MAX_HP];
  const hp: [number, number] = round ? round.hp : full;
  const stage = self.stage;
  const otherName = partner.name[lang];
  const roomIndex = useWorld((s) => s.world.room);
  const backdrop = (ROOMS[roomIndex] ?? ROOMS[HOME]!).bgs.day;


  const settled = useRef(false);
  const growth = pet?.growth;
  const [reward, setReward] = useState(0);
  const [practice, setPractice] = useState(false);
  const [dailyNote, setDailyNote] = useState<"best" | "same" | null>(null);
  // a replay watched to its end (quests count it)
  const replaySeen = useRef(false);
  useEffect(() => {
    if (!finished || !replay || replaySeen.current) return;
    replaySeen.current = true;
    noteEvent("replay-watched");
  }, [finished, replay]);
  // the fight is settled as its last round is shown: once, whatever changes afterwards
  const settle = () => {
    if (settled.current || replay) return;
    settled.current = true;
    // a win by an adopted brain is the brain's, not the pet's: no record, badge or coins
    if (instinct) return;
    const outcome = result.winner === 0 ? "w" : result.winner === 1 ? "l" : "d";
    const first = useSpar.getState().note(partner.id, outcome);
    if (daily) {
      const margin = result.rounds.at(-1) ? result.rounds.at(-1)!.hp[0] - result.rounds.at(-1)!.hp[1] : 0;
      const newBest = useDaily.getState().record(margin, outcome === "w");
      setDailyNote(newBest ? "best" : "same");
    }
    noteTally("SPAR");
    if (partner.id.startsWith("friend:") || partner.look === "behemoth") noteEvent("spar-peer");
    if (outcome === "l") markLoss();
    if (outcome === "w") useBadges.getState().note("sparWins");
    if (outcome === "w") noteTally("SPAR_WIN");
    if (outcome === "w" && partner.look === "behemoth") useBadges.getState().note("behemothWins");
    // Spar skills (plan 4.4): more for a win, and something even for a loss; friendly matches pay nothing, as before
    const skill = sparMods(growth);
    // G6: the day's first PAID_SPARS_PER_DAY paying spars pay; after that a spar is practice, counted but unpaid
    const owed = partner.id.startsWith("friend:") ? 0 : outcome === "w" ? SPAR_WIN_COINS + (first ? SPAR_FIRST_WIN_COINS : 0) + skill.winCoins : outcome === "l" ? skill.lossCoins + boostCoins : 0;
    if (owed > 0) {
      const paid = useWorld.getState().paySpar(owed);
      setReward(paid);
      setPractice(paid === 0);
      if (paid > 0 && outcome === "w") play("success");
    }
  };

  const settleOnce = useEffectEvent(settle);
  // each round is shown after the last one, and the last one settles the fight
  useEffect(() => {
    if (finished) return;
    const id = setTimeout(() => {
      const r = result.rounds[shown]!;
      play(r.hits[0] || r.hits[1] ? "pop" : "tap");
      setShown(shown + 1);
      if (shown + 1 >= result.rounds.length) settleOnce();
    }, shown === 0 ? SPAR_FIRST_ROUND_MS : reduce ? 450 : SPAR_ROUND_MS);
    return () => clearTimeout(id);
  }, [shown, finished, result, reduce]);
  const face = (side: 0 | 1): Expression => {
    if (finished) return result.winner === side ? "proud" : result.winner === -1 ? "happy" : "sad";
    if (!round) return "neutral";
    if (round.hits[1 - side]! >= 14) return "startled";
    if (round.moves[side] === "rest") return "sleepy";
    if (round.moves[side] === "snack") return "munch";
    if (round.moves[side] === "charm" || round.moves[side] === "gift") return "love";
    return round.moods[side]! >= 2 ? "sparkly" : round.moods[side] === 0 ? "sulk" : "neutral";
  };
  const myFace = face(0);
  const theirFace = face(1);
  const form = pet?.form;
  const mine = useMemo(() => drawPet(self.line, stage, { expression: myFace, ...(form && !replay ? { form } : {}) }), [self.line, stage, myFace, form, replay]);
  // our own pet fights in its outfit (looks only)
  const world = useWorld((s) => s.world);
  const worn = pet && !replay ? (outfitOf(world, String(pet.bornAt)) as Outfit) : NO_OUTFIT;
  const mineWorn = useMemo(() => (worn.head || worn.face || worn.held ? wearOverlay(mine, self.line, stage, worn, 0, form) : undefined), [mine, self.line, stage, worn, form]);
  // Behemoth's lamps show the number its CPU holds this round
  const theirsWorn = useMemo(
    () => (partner.look === "behemoth" ? wearOverlay(drawPet(partner.line, partner.stage, {}), partner.line, partner.stage, { head: `b:lamps${behemothAt(shown * BEHEMOTH_STEPS_PER_ROUND).acc}` }, 0) : undefined),
    [partner.look, partner.line, partner.stage, shown],
  );
  const flap = !!round && round.moves[1] === "pounce";
  const theirs = useMemo(
    () => (partner.look === "fly" ? drawFly({ flap, hurt: theirFace === "startled" || theirFace === "sad" }) : drawPet(partner.line, partner.stage, { expression: theirFace })),
    [partner.look, partner.line, partner.stage, flap, theirFace],
  );

  return (
    <div className="sp-fight">
      <div className="sp-head">
        <span>{lang === "zh" ? `第 ${Math.max(1, shown)} / 16 回合` : `Round ${Math.max(1, shown)} of 16`}</span>
        {/* B7: the daily is marked as the daily while it is fought */}
        {daily && <span className="sp-cheering">{lang === "zh" ? "今日挑战" : "Today's challenge"}</span>}
        {cheer && <span className="sp-cheering">{lang === "zh" ? "你在加油" : "You're cheering"}</span>}
        {instinct && <span className="sp-cheering">{lang === "zh" ? `本能：${instinct}` : `Instinct: ${instinct}`}</span>}
        {boosted && !replay && <span className="sp-cheering">{lang === "zh" ? "用上了备好的加成" : "Bonus from the bag"}</span>}
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
              <span className="sp-hp" role="meter" aria-valuemin={0} aria-valuemax={full[side]} aria-valuenow={hp[side]} aria-label={lang === "zh" ? "体力" : "health"}>
                <i style={{ transform: `scaleX(${Math.min(1, hp[side] / full[side])})` }} />
              </span>
            </div>
            <motion.div
              key={`${side}-${shown}`}
              className="sp-body"
              animate={round && round.hits[1 - side]! > 0 && !reduce ? { x: [0, side === 0 ? -6 : 6, 0, side === 0 ? -3 : 3, 0] } : round && round.moves[side] === "pounce" && !reduce ? { x: [0, side === 0 ? 14 : -14, 0] } : {}}
              transition={{ duration: 0.38 }}
            >
              <PetArt canvas={side === 0 ? mine : theirs} line={side === 0 ? self.line : partner.line} palette={side === 1 && partner.look === "fly" ? FLY : side === 1 && partner.look === "behemoth" ? SILICON : side === 1 ? coloursOf(partner) : undefined} scale={4} overlay={side === 0 ? mineWorn : theirsWorn} />
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
          {/* the daily is one fight for one mind: the same mind fights it the same way, so a retry starts from its card */}
          {lang === "zh" ? " 每日挑战对同一个心智永远是同一场；教了新东西后，从每日挑战卡片再来。" : " The daily is the same fight for the same mind; after teaching it something, try again from the daily card."}
        </p>
      )}
      {finished && (replay || !pet ? <ReplayResult self={self} partner={partner} result={result} onDone={onDone} /> : <Result pet={pet} partner={partner} result={result} reward={reward} practice={practice} opponent={opponent} duel={duel} cheer={cheer} instinct={instinct} daily={daily} onDone={onDone} onRematch={onRematch} {...(onWatchAgain ? { onWatchAgain } : {})} />)}
    </div>
  );
}

function Result({ pet, partner, result, reward, practice = false, opponent, duel, cheer, instinct, daily = false, onDone, onRematch, onWatchAgain }: { pet: Pet; partner: Partner; result: SparResult; reward: number; practice?: boolean; opponent?: Fighter; duel?: FightState["duel"]; cheer: boolean; instinct?: string; daily?: boolean; onDone: () => void; onRematch: () => void; onWatchAgain?: () => void }) {
  const [backLink, setBackLink] = useState("");
  const lang = useLang((s) => s.lang) as Lang;
  const learn = useGame((s) => s.learn);
  const swapLesson = useGame((s) => s.swapLesson);
  const [note, setNote] = useState<CoachNote | null>(null);
  const [taught, setTaught] = useState<"idle" | "done" | string>("idle");
  // the coach looks at the pet as it was in this fight; teaching afterwards does not re-run it
  const [asFought] = useState(pet);
  useEffect(() => {
    const pet = asFought;
    if (result.winner === 0) return;
    // the coach runs a few hundred practice spars; let the result paint first
    const id = setTimeout(() => {
      const stage = stageOf(pet, now());
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
          outside: pet.outside,
          growth: pet.growth,
          slots: questSlots(),
          opponent: opponent ?? fighterOfPartner(partner, result.version),
        }),
      );
    }, 60);
    return () => clearTimeout(id);
  }, [result, partner, opponent, asFought]);

  const title = result.winner === 0 ? (lang === "zh" ? `${pet.name}赢了！` : `${pet.name} won!`) : result.winner === 1 ? (lang === "zh" ? `${partner.name.zh}赢了` : `${partner.name.en} won`) : lang === "zh" ? "平手" : "A draw";
  return (
    <motion.div className="sp-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <h3>{title}</h3>
      {partner.id.startsWith("friend:") && <p className="small">{lang === "zh" ? "和朋友的友谊赛，不发金币。" : "A friendly match with a friend's pet: no coins."}</p>}
      {reward > 0 && <p className="sp-coins">{lang === "zh" ? `+${reward} 金币` : `+${reward} coins`}</p>}
      {practice && <p className="small sp-practice">{lang === "zh" ? `今天 ${PAID_SPARS_PER_DAY} 场有奖切磋已经用完，这场算练习：不发金币，但任务、徽章和战绩照样记。明天再来。` : `Today's ${PAID_SPARS_PER_DAY} paid spars are used, so this one was practice: no coins, but it still counts for quests, badges and the record. More pay tomorrow.`}</p>}
      {instinct && (
        <p className="small">
          {lang === "zh"
            ? `${pet.name}这一场用的是收养的本能「${instinct}」，所以不计战绩、不发金币。教练的建议是针对它自己的心智的，收养的大脑不会因为上课而改变。`
            : `${pet.name} fought this one with its adopted instinct, ${instinct}, so it doesn't count toward its record or earn coins. The coach's advice is for its own mind; lessons don't change an adopted brain.`}
        </p>
      )}
      {result.winner !== 0 && (
        <div className="sp-coach">
          <p className="label">{lang === "zh" ? "教练说" : "Coach says"}</p>
          {!note && <p className="small">{lang === "zh" ? "教练在看回放……" : "The coach is watching the replay…"}</p>}
          {note && <p>{why(note.key, pet.name, partner.name[lang], lang)}</p>}
          {note?.lesson && (
            <>
              {note.replace !== undefined && asFought.lessons[note.replace] ? (
                <>
                  <p>{lang === "zh" ? "它的心智满了。把这一课换掉：" : "Its mind is full. Swap this lesson out:"}</p>
                  <div className="sp-swap-out">
                    {(() => {
                      const c = chipsFor(programFor(asFought.line, asFought.lessons, asFought.instincts ?? 0, asFought.growth), asFought.lessons[note.replace]!, lang);
                      return <Chips when={c.when} then={c.then} want={c.want} />;
                    })()}
                  </div>
                  <p>
                    {lang === "zh" ? "换成：" : "for: "}
                    <b>{note.lesson.label[lang]}</b>
                  </p>
                </>
              ) : (
                <p>
                  {lang === "zh" ? "试着教它：" : "Try teaching it: "}
                  <b>{note.lesson.label[lang]}</b>
                </p>
              )}
              <p className="small">
                {lang === "zh"
                  ? `在 ${PRACTICE_SEEDS} 场练习里，这样能赢 ${note.after} 场（现在是 ${note.before} 场）。`
                  : `In ${PRACTICE_SEEDS} practice spars this wins ${note.after} (it wins ${note.before} now).`}
              </p>
              {taught === "done" ? (
                <p className="sp-ok">{lang === "zh" ? "学会了！再来一场试试。" : "Learned! Try a rematch."}</p>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const r = note.replace !== undefined ? swapLesson(note.replace, note.lesson!.rule) : learn(note.lesson!.rule);
                    setTaught(r.ok ? "done" : r.reason);
                  }}
                >
                  {note.replace !== undefined ? (lang === "zh" ? "换成这一课" : "Swap it in") : lang === "zh" ? "教它这个" : "Teach this"}
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
            <p className="small">
              {lang === "zh"
                ? `教练的切磋课，不管是新教还是换掉一课，在 ${PRACTICE_SEEDS} 场练习里都赢不了更多。可以在心智里亲手教它一条规则。`
                : `None of the coach's fight lessons, taught new or swapped in, wins more of ${PRACTICE_SEEDS} practice spars here. You can teach it a rule of your own in Mind.`}
            </p>
          )}
        </div>
      )}
      {duel && (
        <div className="sp-duel">
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const url = `${linkPrefix("play.html")}duelr=${await linkToken(encodeResult(duel))}`;
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
            {/* after the daily, a rematch is a practice spar (a seed of its own, not counted): it says so (B7) */}
            {daily ? (lang === "zh" ? `和${partner.name.zh}练习一场` : `Practise against ${partner.name.en}`) : lang === "zh" ? "再来一场" : "Rematch"}
          </button>
        )}
        {onWatchAgain && (
          <button type="button" className="btn" onClick={() => (play("tap"), onWatchAgain())}>
            {lang === "zh" ? "再看一遍" : "Watch it again"}
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "换个对手" : "Other partners"}
        </button>
      </div>
      <p className="small sp-fp">
        {lang === "zh" ? `回放指纹 ${result.digest} · 种子 ${result.seed}` : `Replay ${result.digest} · seed ${result.seed}`}
      </p>
      {/* both replay the pet's own mind, which did not fight this one */}
      {!instinct && <SparChainCheck pet={asFought} partner={partner} opponent={opponent} result={result} cheer={cheer} />}
      {!instinct && <FightRewind pet={asFought} result={result} other={otherSide(partner, opponent, duel, result.version)} />}
    </motion.div>
  );
}

/** A4 for a spar: re-run it with the brain read back from X Layer, and let the chain confirm every move. */
function SparChainCheck({ pet, partner, opponent, result, cheer }: { pet: Pet; partner: Partner; opponent?: Fighter; result: SparResult; cheer: boolean }) {
  return (
    <ChainCheck
      pet={pet}
      rounds={result.rounds.length}
      run={(petId, onProgress) => {
        const me = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts, outside: pet.outside, growth: pet.growth }, levelOf(stageOf(pet, now())), pet.brain);
        return checkSparOnChain({ petId, me, them: () => opponent ?? fighterOfPartner(partner, result.version), result, cheer, onProgress });
      }}
    />
  );
}

const RULE_SOURCE: Record<ReturnType<typeof ruleSource>, { en: string; zh: string }> = {
  taught: { en: "from something you taught it", zh: "来自你教它的" },
  instinct: { en: "from an instinct it hatched with", zh: "来自它天生的本能" },
  born: { en: "from how its egg line is born", zh: "来自它这一系生来就会的" },
  default: { en: "nothing matched, so its default move", zh: "没有条件符合，按默认出招" },
  outside: { en: "from the instinct circuit it was taught", zh: "来自它学会的本能电路" },
};

/** Why a move made differs from the move the brain chose: not enough stamina, or a pounce slipped into a tap. */
function changedNote(chose: number, made: Move, lang: Lang): string {
  return lang === "zh"
    ? `大脑选了${MOVE_LABEL.zh[chose]}，但${made === "rest" ? "力气不够出这一招，只能休息" : "扑空了，变成轻拍"}。`
    : `Its brain chose ${MOVE_LABEL.en[chose]}, but ${made === "rest" ? "it did not have the stamina for that, so it rested" : "the pounce slipped into a tap"}.`;
}

/** The other side of a fight as the rewind reads it: its name, and its mind when it is a pet's (not a fly's or Behemoth's). */
function otherSide(partner: Partner, opponent: Fighter | undefined, duel: FightState["duel"], version: SparVersion): { name: { en: string; zh: string }; mind: Mind | null; memory?: number[] } {
  if (duel) {
    const m = duelPetMind(duel.challenge.from);
    return { name: partner.name, mind: m?.mind ?? null, ...(m?.memory ? { memory: m.memory } : {}) };
  }
  // a fighter brought in from elsewhere (a fly link, Behemoth) has no pet mind to rewind
  return { name: partner.name, mind: opponent ? null : partnerMind(partner, version) };
}

const OPEN: Record<"rest" | "snack" | "charm", { en: string; zh: string }> = {
  rest: { en: "resting", zh: "在休息" },
  snack: { en: "snacking", zh: "在吃零食" },
  charm: { en: "charming", zh: "在卖萌" },
};

/** One exchange in words: what LX-SPAR/2's rules did with the round's two moves. */
function exchangeLine(e: Exchange, names: [string, string], lang: Lang): string {
  const fav = names[e.by];
  const oth = names[1 - e.by]!;
  const zh = lang === "zh";
  switch (e.kind) {
    case "guarded":
      return zh ? `${oth}扑进了${fav}${e.timed ? "及时的" : ""}防守：${oth}一个踉跄，被反弹了 ${e.back} 点。` : `${oth} pounced into ${fav}'s ${e.timed ? "well-timed " : ""}guard: ${oth} staggered and took ${e.back} back.`;
    case "dodged":
      return zh ? `${fav}干净利落地躲开了${oth}的扑击，反击 ${e.back} 点。` : `${fav} dodged ${oth}'s pounce cleanly and hit back for ${e.back}.`;
    case "caught":
      return zh ? `${oth}想躲开${fav}的扑击，却被扑个正着。` : `${oth} tried to dodge ${fav}'s pounce and was caught.`;
    case "punished":
      return zh ? `${fav}趁${oth}${OPEN[e.open].zh}时扑过去，多造成 ${SPAR_PUNISH} 点。` : `${fav} pounced while ${oth} was ${OPEN[e.open].en}: ${SPAR_PUNISH} extra damage.`;
    case "feint":
      return zh ? `${fav}的卖萌绕过了${oth}的防守，造成 ${e.hit} 点。` : `${fav}'s charm slipped past ${oth}'s guard for ${e.hit}.`;
  }
}

/** F11 for spars, both sides (G2): scrub the rounds and see which rule of each brain picked each move, and what came of it. */
function FightRewind({ pet, result, other }: { pet: Pet; result: SparResult; other: ReturnType<typeof otherSide> }) {
  const lang = useLang((s) => s.lang) as Lang;
  const why = useMemo(
    () =>
      rewindFight(
        { ...(pet.family ? { halves: halvesOf(pet.family, pet.lessons, skillRules(pet.growth)) } : { program: programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth) }), ...(pet.outside ? { outside: pet.outside } : {}) },
        pet.brain,
        result.rounds.map((r) => r.words[0]),
      ),
    [pet, result],
  );
  const otherWhy = useMemo(() => (other.mind ? rewindFight(other.mind, other.memory ?? [], result.rounds.map((r) => r.words[1])) : null), [other, result]);
  const [k, setK] = useState(0);
  if (!why.length) return null;
  const w = why[Math.min(k, why.length - 1)]!;
  const round = result.rounds[Math.min(k, why.length - 1)]!;
  const chips = w.outside ? (lang === "zh" ? { when: ["它学会的本能电路想出招"], then: MOVE_LABEL.zh[w.want] ?? "", want: w.want } : { when: ["its taught instinct circuit wanted a move"], then: MOVE_LABEL.en[w.want] ?? "", want: w.want }) : decidingChips(w.program, w.rule, lang, true);
  const chosen = MOVES[w.want]!;
  const changed = round.moves[0] !== chosen;
  const ow = otherWhy?.[Math.min(k, why.length - 1)];
  const otherChips = ow ? (ow.outside ? { when: [lang === "zh" ? "它学会的本能电路想出招" : "its taught instinct circuit wanted a move"], then: MOVE_LABEL[lang][ow.want] ?? "", want: ow.want } : decidingChips(ow.program, ow.rule, lang, true)) : null;
  const exchanges = exchangesOf(result.version, result.rounds, Math.min(k, why.length - 1));
  const names: [string, string] = [pet.name, other.name[lang]];
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
          {changed && <span>{changedNote(w.want, round.moves[0], lang)}</span>}
        </p>
        <div className="rw-rule">
          <Chips when={chips.when} then={chips.then} want={chips.want} />
          <small>{RULE_SOURCE[ruleSource(w)][lang]}</small>
        </div>
        <div className="rw-rule rw-other">
          <p className="small">
            <b>{other.name[lang]}</b>
            {lang === "zh" ? `：${MOVE_LABEL.zh[MOVES.indexOf(round.moves[1])]}` : `: ${MOVE_LABEL.en[MOVES.indexOf(round.moves[1])]}`}
          </p>
          {ow && round.moves[1] !== MOVES[ow.want] && <small>{changedNote(ow.want, round.moves[1], lang)}</small>}
          {otherChips ? (
            <Chips when={otherChips.when} then={otherChips.then} want={otherChips.want} />
          ) : (
            <small>{lang === "zh" ? "它自己的电路这样出招，看不到规则。" : "Its own circuit chose this; it has no rules to show."}</small>
          )}
        </div>
        {exchanges.length > 0 && (
          <ul className="rw-ex">
            {exchanges.map((e, i) => (
              <li key={i}>{exchangeLine(e, names, lang)}</li>
            ))}
          </ul>
        )}
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
function DailyCard({ pet, onStart }: { pet: Pet; onStart: (partner: Partner, seed: number, day: number) => void }) {
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
        <PetArt canvas={art} line={partner.line} palette={coloursOf(partner)} scale={2} label={partner.name[lang]} />
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
        <button type="button" className="btn primary" disabled={status !== "ready" || seed === null || !block} onClick={() => seed !== null && block && onStart(partner, seed, block.day)}>
          {lang === "zh" ? "挑战" : "Spar"}
        </button>
      )}
    </section>
  );
}
