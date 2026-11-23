/**
 * P3: the landing's three living demos (the mind thinking, a lesson becoming a rule, a spar), loaded only when one
 * comes near the screen: they bring the game, the circuit view and the fight, which the first screen does not need.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { CORAL, SKY, drawPet } from "@lingxi/art";
import { STARTERS } from "@lingxi/brain";
import { CURRENT_SPAR, PARTNERS, PET_SCHOOL, care, createPet, fight, fighterFrom } from "@lingxi/game";
import { useLang } from "../i18n";
import { brainFor } from "../game/store";
import { BrainView } from "../play/BrainView";
import { Chips } from "../play/parts";
import { Sprite } from "../play/Sprite";
import { MOVE_WORDS, chipsFor } from "../play/ruleText";

export function MindDemo({ reduce }: { reduce: boolean }) {
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

export function TeachDemo({ reduce }: { reduce: boolean }) {
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

/** A real spar, replayed round by round: the gentle starter against Pip. */
export function SparDemo({ reduce }: { reduce: boolean }) {
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
  // the spar's own words for each move (B7), lower case in the running text of this demo
  const MOVES: Record<string, [string, string]> = Object.fromEntries(Object.entries(MOVE_WORDS).map(([k, [en, zh]]) => [k, [en.toLowerCase(), zh]]));
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
