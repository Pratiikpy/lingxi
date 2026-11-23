/**
 * P3: the landing's two drawn scenes below the fold (the stages a pet grows through, two friends sharing a room), in a
 * module of their own: they need only the pixel art, so loading them as they come near brings none of the game.
 */
import { useMemo } from "react";
import { motion } from "motion/react";
import { CORAL, SHELL, SUNNY, drawEgg, drawPet } from "@lingxi/art";
import { useLang } from "../i18n";
import { Sprite } from "../play/Sprite";
import { COPY } from "./copy";

const STAGES = ["egg", "baby", "child", "teen", "adult"] as const;

/** The five stages a pet grows through, drawn. */
export function GrowStrip() {
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

/** Two pets sharing a room live, with a wave, a heart and a gift in flight. */
export function FriendsScene({ reduce }: { reduce: boolean }) {
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
