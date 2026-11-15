/**
 * The Lingxi landing page. Every section shows the real thing: real sprites,
 * the pet's real compiled circuit, real Pet School lessons, real rooms and real
 * measured numbers. Sections for features not built yet are left out rather
 * than mocked.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CORAL, SHELL, drawEgg, drawPet } from "@lingxi/art";
import { STARTERS, compileProgram, gateCount } from "@lingxi/brain";
import { PET_SCHOOL, createPet, care } from "@lingxi/game";
import { useLang } from "../i18n";
import { brainFor } from "../game/store";
import { BrainView } from "../play/BrainView";
import { Chips } from "../play/parts";
import { Sprite } from "../play/Sprite";
import { chipsFor } from "../play/ruleText";
import { HeroScene } from "./HeroScene";
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
        {chips ? <Chips when={chips.when} then={chips.then} /> : <span className="chip">{lang === "zh" ? "发呆" : "rest"}</span>}
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
  useEffect(() => {
    if (reduce) {
      setTyped(text.length);
      return;
    }
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
  const done = typed >= text.length;
  const chips = chipsFor(STARTERS.gentle, lesson.rule, lang);
  return (
    <div className="teach-demo">
      <div className="say-box">
        <span>{text.slice(0, typed)}</span>
        <i className="caret" aria-hidden="true" />
      </div>
      <motion.div className="rule-out" animate={{ opacity: done ? 1 : 0.25, y: done ? 0 : 4 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
        <Chips when={chips.when} then={chips.then} />
      </motion.div>
    </div>
  );
}

export function LandingApp() {
  const { lang, toggle } = useLang();
  const reduce = useReducedMotion() ?? false;
  const c = COPY[lang];
  const gates = useMemo(() => gateCount(compileProgram(STARTERS.gentle)), []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "灵犀 · 养一个小小的心智" : "Lingxi · Raise a little mind";
  }, [lang]);
  return (
    <>
      <header className="l-hero">
        <HeroScene reduceMotion={reduce} />
        <nav className="l-nav">
          <a className="l-brand" href="#top" id="top">
            <span>Lingxi</span>
            <small>灵犀</small>
          </a>
          <div className="l-links">
            <a href="#grow">{c.nav[0]}</a>
            <a href="#mind">{c.nav[1]}</a>
            <a href="#teach">{c.nav[2]}</a>
            <a href="#proof">{c.nav[3]}</a>
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
              teach.txt
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
                <img className="pixel" src={`pet/rooms/${src}`} alt="" width={128} height={128} loading="lazy" />
                <span>{lang === "zh" ? zh : en}</span>
              </li>
            ))}
          </ul>
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
          <a className="l-cta ghost" href="verify.html">
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

      <footer className="l-foot">
        <span>Lingxi · 灵犀</span>
        <span>{c.foot}</span>
      </footer>
    </>
  );
}
