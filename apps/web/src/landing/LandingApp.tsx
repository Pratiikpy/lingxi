/**
 * The Lingxi landing page. Every section shows the real thing: real sprites,
 * the pet's real compiled circuit, real Pet School lessons, real rooms and real
 * measured numbers, and the spar is the real engine. Ten parts: hero, growth,
 * mind, teaching, world and residents, friends, spars, proof, start, footer.
 */

import { OnChainNote } from "../OnChainNote";
import { type ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { STARTERS, compileProgram, gateCount } from "@lingxi/brain";
import { CHARACTERS } from "@lingxi/world";
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { HeroScene, type HeroPhase, phaseNow } from "./HeroScene";
import { COPY } from "./copy";
import "../play/play.css";
import "./landing.css";

const ROOMS = [
  ["65_forest-hut/backgrounds/room65a.png", "home", "家"],
  ["53_blooming-tree/backgrounds/playtest-a.png", "the blooming tree", "开花的树"],
  ["69_lotus-pool/backgrounds/room69.png", "lotus pool", "莲池"],
  ["76_fungus-garden/backgrounds/room76.png", "mushroom garden", "蘑菇园"],
  ["13_giftshop/backgrounds/original.png", "gift shop", "礼品店"],
  ["90_scenic-view/backgrounds/room90.png", "the window", "窗边"],
] as const;

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

const MindDemo = lazy(() => import("./LandingDemos").then((m) => ({ default: m.MindDemo })));
const TeachDemo = lazy(() => import("./LandingDemos").then((m) => ({ default: m.TeachDemo })));
const SparDemo = lazy(() => import("./LandingDemos").then((m) => ({ default: m.SparDemo })));
const GrowStrip = lazy(() => import("./LandingScenes").then((m) => ({ default: m.GrowStrip })));
const FriendsScene = lazy(() => import("./LandingScenes").then((m) => ({ default: m.FriendsScene })));

/**
 * P3: a demo's place, held at its size, mounting the demo only once it comes within 200 px of view (or at once
 * without IntersectionObserver), so the first screen loads none of the game and nothing below moves when it arrives.
 */
function Near({ kind, children }: { kind: "mind" | "teach" | "spar" | "grow" | "friends"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return void setNear(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`demo-slot demo-${kind}`}>
      {near && <Suspense fallback={null}>{children}</Suspense>}
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
          <Near kind="grow">
            <GrowStrip />
          </Near>
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
            <Near kind="mind">
              <MindDemo reduce={reduce} />
            </Near>
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
            <Near kind="teach">
              <TeachDemo reduce={reduce} />
            </Near>
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
          <Near kind="friends">
            <FriendsScene reduce={reduce} />
          </Near>
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
            <Near kind="spar">
              <SparDemo reduce={reduce} />
            </Near>
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

        <section id="holders" className="l-sec l-holders" aria-labelledby="holders-h">
          <p className="l-label">{c.holdLabel}</p>
          <h2 id="holders-h">{c.holdH}</h2>
          <p className="l-p">{c.holdP}</p>
          <ul className="l-perks">
            {c.holdPerks.map((x) => (
              <li key={x[0]}>
                <b>{x[0]}</b>
                <span>{x[1]}</span>
              </li>
            ))}
          </ul>
          <a className="l-cta ghost" href="play.html">
            {c.holdCta}
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
