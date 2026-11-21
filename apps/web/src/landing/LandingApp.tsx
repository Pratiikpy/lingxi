/**
 * The Lingxi landing page. Every section shows the real thing: real sprites,
 * the pet's real compiled circuit, real Pet School lessons, real rooms and real
 * measured numbers, and the spar is the real engine. Ten parts: hero, growth,
 * mind, teaching, world and residents, friends, spars, proof, start, footer.
 */

import { OnChainNote } from "../OnChainNote";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CORAL, SHELL, SKY, SUNNY, drawEgg, drawPet } from "@lingxi/art";
import { STARTERS, compileProgram, gateCount } from "@lingxi/brain";
import { CURRENT_SPAR, PARTNERS, PET_SCHOOL, createPet, care, fight, fighterFrom } from "@lingxi/game";
import { CHARACTERS } from "@lingxi/world";
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { brainFor } from "../game/store";
import { BrainView } from "../play/BrainView";
import { Chips } from "../play/parts";
import { Sprite } from "../play/Sprite";
import { chipsFor } from "../play/ruleText";
import { HeroScene, type HeroPhase, phaseNow } from "./HeroScene";
import { COPY } from "./copy";
import "../play/play.css";
import "./landing.css";

const STAGES = ["egg", "baby", "child", "teen", "adult"] as const;
const ROOMS = [
  ["65_forest-hut/backgrounds/room65a.png", "home", "家"],
  ["53_blooming-tree/backgrounds/playtest-a.png", "the blooming tree", "开花的树"],
  ["69_lotus-pool/backgrounds/room69.png", "lotus pool", "莲池"],
  ["76_fungus-garden/backgrounds/room76.png", "mushroom garden", "蘑菇园"],
  ["13_giftshop/backgrounds/original.png", "gift shop", "礼品店"],
  ["90_scenic-view/backgrounds/room90.png", "the window", "窗边"],
] as const;

function GrowStrip() {
  const { lang } = useLang();
  const c = COPY[lang];
  const egg = useMemo(() => drawEgg("coral"), []);
  const pets = useMemo(() => (["baby", "child", "teen", "adult"] as const).map((s) => drawPet("gentle", s, { expression: s === "adult" ? "sparkly" : s === "teen" ? "proud" : "happy", lit: s === "adult" || s === "teen" })), []);
  return (
    <ol className="grow">
      {STAGES.map((s, i) => (
        <li key={s}>
          {i === 0 ? <Sprite canvas={egg} palette={{ ...SHELL, x: CORAL.m, X: CORAL.d }} scale={2.5} /> : <Sprite canvas={pets[i - 1]!} palette={CORAL} scale={2.5} />}
          <b>{c.stages[i]![0]}</b>
          <span>{c.stages[i]![1]}</span>
        </li>
      ))}
    </ol>
  );
}

function MindDemo({ reduce }: { reduce: boolean }) {
  const { lang } = useLang();
  const brain = brainFor("gentle");
  const [pet, setPet] = useState(() => createPet({ name: "Mochi", line: "gentle", now: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset(), brain }));
  useEffect(() => {
    if (reduce) return;
    const kinds = [{ kind: "pet" }, { kind: "play" }, { kind: "feed", food: "apple" }, { kind: "talk" }, { kind: "clean" }] as const;
    let i = 0;
    const id = setInterval(() => {
      setPet((p) => care(p, kinds[i++ % kinds.length]!, Date.now(), brain).pet);
    }, 2600);
    return () => clearInterval(id);
  }, [brain, reduce]);
  const rule = pet.last.rule >= 0 ? STARTERS.gentle.rules[pet.last.rule] : undefined;
  const chips = rule ? chipsFor(STARTERS.gentle, rule, lang) : null;
  return (
    <div className="mind-demo">
      <BrainView pet={pet} reduceMotion={reduce} />
      <div className="think-line" aria-live="off">
        <em>{lang === "zh" ? "刚刚在想" : "just thought"}</em>
        {chips ? <Chips when={chips.when} then={chips.then} want={chips.want} /> : <span className="chip">{lang === "zh" ? "发呆" : "rest"}</span>}
      </div>
    </div>
  );
}

function TeachDemo({ reduce }: { reduce: boolean }) {
  const { lang } = useLang();
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const lesson = PET_SCHOOL[i % PET_SCHOOL.length]!;
  const text = lesson.say[lang];
  // with reduced motion the first lesson stands written out in full, and nothing moves
  const shown = reduce ? text.length : typed;
  useEffect(() => {
    if (reduce) return;
    if (typed < text.length) {
      const id = setTimeout(() => setTyped((n) => n + 1), lang === "zh" ? 110 : 45);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setI((n) => n + 1);
      setTyped(0);
    }, 3200);
    return () => clearTimeout(id);
  }, [typed, text, lang, reduce]);
  const done = shown >= text.length;
  const chips = chipsFor(STARTERS.gentle, lesson.rule, lang);
  return (
    <div className="teach-demo">
      <div className="say-box">
        <span>{text.slice(0, shown)}</span>
        <i className="caret" aria-hidden="true" />
      </div>
      <motion.div className="rule-out" animate={{ opacity: done ? 1 : 0.25, y: done ? 0 : 4 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
        <Chips when={chips.when} then={chips.then} want={chips.want} />
      </motion.div>
      {/* these are Pet School lessons, words and rule written together; words a player types are turned into a rule
          when they teach (A110) */}
      <p className="teach-note">{lang === "zh" ? "宠物学堂的课：话和规则是一起写好的。你自己写的话，会在教它时变成规则。" : "Pet School lessons: the words and the rule are written together. Words you write yourself become a rule when you teach."}</p>
    </div>
  );
}

/** The residents, with their own portraits and roles. */
function Residents() {
  const { lang } = useLang();
  const who = CHARACTERS.filter((c) => ["wick", "praline", "twain", "jab", "why", "yonder"].includes(c.id));
  return (
    <ul className="residents">
      {who.map((c) => (
        <li key={c.id}>
          <img className="pixel" src={`art/npcs/${c.stand}`} alt="" loading="lazy" />
          <b style={{ background: c.color }}>{c.name[lang]}</b>
          <span>{c.role[lang]}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two pets sharing a room live, with a wave, a heart and a gift in flight. */
function FriendsScene({ reduce }: { reduce: boolean }) {
  const { lang } = useLang();
  const a = useMemo(() => drawPet("gentle", "child", { expression: "happy" }), []);
  const b = useMemo(() => drawPet("bold", "teen", { expression: "love" }), []);
  return (
    <div className="friends-scene" style={{ backgroundImage: "url(art/rooms/65_forest-hut/backgrounds/room65a.png)" }}>
      <div className="fs-pet fs-a">
        <motion.div animate={reduce ? {} : { y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
          <Sprite canvas={a} palette={CORAL} scale={3} />
        </motion.div>
        <b>Mochi</b>
      </div>
      <div className="fs-pet fs-b">
        <span className="fs-bubble">{lang === "zh" ? "嗨！" : "hi!"}</span>
        <Sprite canvas={b} palette={SUNNY} scale={3} />
        <b>Tofu</b>
      </div>
      {!reduce &&
        [0, 1, 2].map((i) => (
          <motion.span key={i} className="fs-heart" initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 0], y: -60 }} transition={{ repeat: Infinity, duration: 2.4, delay: i * 0.8 }} aria-hidden="true">
            ♥
          </motion.span>
        ))}
    </div>
  );
}

/** A real spar, replayed round by round: the gentle starter against Pip. */
function SparDemo({ reduce }: { reduce: boolean }) {
  const { lang } = useLang();
  const result = useMemo(() => {
    const pip = PARTNERS.find((p) => p.id === "pip")!;
    for (let seed = 1; seed < 200; seed++) {
      const r = fight(CURRENT_SPAR, fighterFrom("Mochi", STARTERS.gentle, 0), fighterFrom("Pip", pip.program, pip.level), seed);
      if (r.rounds.length >= 8) return r;
    }
    return fight(CURRENT_SPAR, fighterFrom("Mochi", STARTERS.gentle, 0), fighterFrom("Pip", pip.program, pip.level), 1);
  }, []);
  const [n, setN] = useState(reduce ? result.rounds.length : 1);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setN((k) => (k >= result.rounds.length + 3 ? 1 : k + 1)), 900);
    return () => clearInterval(id);
  }, [reduce, result.rounds.length]);
  const r = result.rounds[Math.min(n, result.rounds.length) - 1]!;
  const MOVES: Record<string, [string, string]> = { tap: ["tap", "轻拍"], snack: ["snack", "吃点心"], pounce: ["pounce!", "猛扑！"], rest: ["rest", "歇一歇"], dodge: ["dodge", "闪开"], guard: ["guard", "防守"], charm: ["charm", "撒娇"], gift: ["gift", "送礼"] };
  const pa = useMemo(() => drawPet("gentle", "child", { expression: "happy" }), []);
  const pb = useMemo(() => drawPet("curious", "child", { expression: "proud" }), []);
  return (
    <div className="spar-demo">
      <div className="sd-head">
        <span>{lang === "zh" ? `第 ${Math.min(n, result.rounds.length)} 回合` : `Round ${Math.min(n, result.rounds.length)}`}</span>
        <span className="mono">{lang === "zh" ? `回放 ${result.digest}` : `replay ${result.digest}`}</span>
      </div>
      <div className="sd-ring" style={{ backgroundImage: "url(art/rooms/49_clearing/backgrounds/playtest-a.png)" }}>
        {([0, 1] as const).map((side) => (
          <div key={side} className={`sd-f sd-${side}`}>
            <i className="sd-hp">
              <i style={{ transform: `scaleX(${r.hp[side] / 100})` }} />
            </i>
            <Sprite canvas={side === 0 ? pa : pb} palette={side === 0 ? CORAL : SKY} scale={2.5} />
            <span className="sd-move">{MOVES[r.moves[side]]![lang === "zh" ? 1 : 0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingApp() {
  const { lang, toggle } = useLang();
  const reduce = useReducedMotion() ?? false;
  const c = COPY[lang];
  const [phase, setPhase] = useState<HeroPhase>(phaseNow);
  const gates = useMemo(() => gateCount(compileProgram(STARTERS.gentle)), []);
  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("index");
  return (
    <>
      <header className="l-hero">
        <HeroScene reduceMotion={reduce} phase={phase} />
        <div className="l-phase" role="radiogroup" aria-label={lang === "zh" ? "时间" : "Time of day"}>
          {(["day", "evening", "night"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={phase === p} onClick={() => setPhase(p)}>
              {lang === "zh" ? { day: "白天", evening: "黄昏", night: "夜晚" }[p] : { day: "Day", evening: "Dusk", night: "Night" }[p]}
            </button>
          ))}
        </div>
        <nav className="l-nav">
          <a className="l-brand" href="#top" id="top">
            <span>Lingxi</span>
            <small>灵犀</small>
          </a>
          <div className="l-links">
            <a href="#grow">{c.nav[0]}</a>
            <a href="#mind">{c.nav[1]}</a>
            <a href="#teach">{c.nav[2]}</a>
            <a href="#friends">{c.nav[3]}</a>
            <a href="#proof">{c.nav[4]}</a>
          </div>
          <div className="l-right">
            <button type="button" className="round-btn" onClick={toggle}>
              {lang === "zh" ? "EN" : "中文"}
            </button>
            <a className="l-cta small-cta" href="play.html">
              {c.cta}
            </a>
          </div>
        </nav>
        <div className="l-copy">
          <span className="l-kicker">心有灵犀一点通</span>
          <h1>{c.h1}</h1>
          <p>{c.lede}</p>
          <div className="l-actions">
            <a className="l-cta" href="play.html">
              {c.cta}
            </a>
            <a className="l-quiet" href="#mind">
              {c.quiet}
            </a>
          </div>
        </div>
        <p className="l-hint">{c.hint}</p>
      </header>

      <main className="l-main">
        <section id="grow" className="l-sec" aria-labelledby="grow-h">
          <p className="l-label">{c.growLabel}</p>
          <h2 id="grow-h">{c.growH}</h2>
          <p className="l-p">{c.growP}</p>
          <GrowStrip />
        </section>

        <section id="mind" className="l-sec l-split" aria-labelledby="mind-h">
          <div className="l-text">
            <p className="l-label">{c.mindLabel}</p>
            <h2 id="mind-h">{c.mindH}</h2>
            <p className="l-p">{c.mindP}</p>
            <ul className="l-facts">
              <li>
                <b>{gates}</b> {c.facts[0]}
              </li>
              <li>
                <b>8</b> {c.facts[1]}
              </li>
              <li>
                <b>65,536</b> {c.facts[2]}
              </li>
            </ul>
          </div>
          <div className="l-window">
            <div className="cardbar" aria-hidden="true">
              <i />
              <i />
              <i />
              mochi.mind
            </div>
            <MindDemo reduce={reduce} />
          </div>
        </section>

        <section id="teach" className="l-sec l-split l-flip" aria-labelledby="teach-h">
          <div className="l-text">
            <p className="l-label">{c.teachLabel}</p>
            <h2 id="teach-h">{c.teachH}</h2>
            <p className="l-p">{c.teachP}</p>
          </div>
          <div className="l-window">
            <div className="cardbar" aria-hidden="true">
              <i />
              <i />
              <i />
              pet-school.txt
            </div>
            <TeachDemo reduce={reduce} />
          </div>
        </section>

        <section id="world" className="l-sec" aria-labelledby="world-h">
          <p className="l-label">{c.worldLabel}</p>
          <h2 id="world-h">{c.worldH}</h2>
          <p className="l-p">{c.worldP}</p>
          <ul className="rooms">
            {ROOMS.map(([src, en, zh]) => (
              <li key={src}>
                <img className="pixel" src={`art/rooms/${src}`} alt="" width={128} height={128} loading="lazy" />
                <span>{lang === "zh" ? zh : en}</span>
              </li>
            ))}
          </ul>
          <p className="l-label l-sub">{c.residents}</p>
          <Residents />
        </section>

        <section id="friends" className="l-sec l-split" aria-labelledby="friends-h">
          <div className="l-text">
            <p className="l-label">{c.friendsLabel}</p>
            <h2 id="friends-h">{c.friendsH}</h2>
            <p className="l-p">{c.friendsP}</p>
            <ul className="l-cards">
              {c.friendsCards.map(([h, d]) => (
                <li key={h}>
                  <b>{h}</b>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <FriendsScene reduce={reduce} />
        </section>

        <section id="spars" className="l-sec l-split l-flip" aria-labelledby="spars-h">
          <div className="l-text">
            <p className="l-label">{c.sparLabel}</p>
            <h2 id="spars-h">{c.sparH}</h2>
            <p className="l-p">{c.sparP}</p>
            <p className="l-coach">{c.sparCoach}</p>
          </div>
          <div className="l-window">
            <div className="cardbar" aria-hidden="true">
              <i />
              <i />
              <i />
              spar.replay
            </div>
            <SparDemo reduce={reduce} />
          </div>
        </section>

        <section id="proof" className="l-sec l-proof" aria-labelledby="proof-h">
          <p className="l-label">{c.proofLabel}</p>
          <h2 id="proof-h">{c.proofH}</h2>
          <p className="l-p">{c.proofP}</p>
          <ol className="proof-steps">
            {c.proofSteps.map((s, i) => (
              <li key={i}>
                <b>{s[0]}</b>
                <span>{s[1]}</span>
              </li>
            ))}
          </ol>
          <a className="l-cta ghost" href="verify.html#1">
            {c.proofCta}
          </a>
        </section>

        <section id="start" className="l-sec l-start" aria-labelledby="start-h">
          <h2 id="start-h">{c.startH}</h2>
          <p className="l-p">{c.startP}</p>
          <a className="l-cta" href="play.html">
            {c.cta}
          </a>
        </section>
      </main>

      <section className="l-note">
        <OnChainNote lang={lang} />
      </section>
      <footer className="l-foot">
        <span>Lingxi · 灵犀</span>
        <span>{c.foot}</span>
        <a className="l-foot-link" href="agents.html">
          {c.agents}
        </a>
        <a className="l-foot-link" href="tree.html">
          {c.tree}
        </a>
        <a className="l-foot-link" href="numbers.html">
          {c.numbers}
        </a>
        {/* anyone can read what runs, on chain and in the repo (A60) */}
        <a className="l-foot-link" href="verify.html#contracts">
          {c.contracts}
        </a>
        <a className="l-foot-link" href="https://github.com/Pratiikpy/lingxi" target="_blank" rel="noopener noreferrer">
          {c.source}
        </a>
      </footer>
    </>
  );
}
