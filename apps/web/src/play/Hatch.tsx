/** First run: pick one of three eggs, name it, watch it hatch. */

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SHELL, drawEgg, drawPet } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";
import { useLang, useT, type Key } from "../i18n";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./hatch.css";

const LINES: readonly StarterLine[] = ["gentle", "bold", "curious"];
const NAMES = {
  en: ["Mochi", "Tofu", "Biscuit", "Pip", "Momo", "Bean", "Dumpling", "Sora", "Kiki", "Plum"],
  zh: ["团子", "豆腐", "麻薯", "小圆", "桃桃", "汤圆", "布丁", "糖糖", "饺子", "芝麻"],
};

export function Hatch({ onHatch }: { onHatch: (line: StarterLine, name: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const reduce = useReducedMotion();
  const [line, setLine] = useState<StarterLine>("gentle");
  const [name, setName] = useState(() => NAMES[lang][Math.floor(Math.random() * NAMES[lang].length)]!);
  const [cracking, setCracking] = useState(-1);
  const eggs = useMemo(
    () =>
      LINES.map((l) => ({
        l,
        pal: { ...SHELL, x: PALETTE_OF[l].m, X: PALETTE_OF[l].d },
        idle: drawEgg("coral", 0),
        cracks: [0, 1, 2, 3].map((k) => drawEgg("coral", 0, k)),
      })),
    [],
  );
  const shuffle = () => {
    const pool = NAMES[lang].filter((n) => n !== name);
    setName(pool[Math.floor(Math.random() * pool.length)]!);
    play("tap");
  };
  const hatch = () => {
    play("hatch");
    if (reduce) {
      onHatch(line, name);
      return;
    }
    let k = 0;
    setCracking(0);
    const id = setInterval(() => {
      k += 1;
      if (k > 4) {
        clearInterval(id);
        onHatch(line, name);
      } else setCracking(k);
    }, 420);
  };
  const chosen = eggs.find((e) => e.l === line)!;
  return (
    <main className="hatch" aria-labelledby="hatch-h">
      <div className="hatch-head">
        <h1 id="hatch-h">{t("hatch.title")}</h1>
        <p>{t("hatch.sub")}</p>
      </div>
      {cracking >= 0 ? (
        <div className="hatch-stage" aria-live="polite">
          {cracking < 4 ? (
            <motion.div animate={{ rotate: [0, -6, 6, -3, 0] }} transition={{ duration: 0.4 }}>
              <Sprite canvas={chosen.cracks[cracking]!} palette={chosen.pal} scale={5} />
            </motion.div>
          ) : (
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}>
              <Sprite canvas={drawPet("gentle", "baby", { expression: "sparkly" })} palette={PALETTE_OF[line]} scale={5} label={name} />
            </motion.div>
          )}
        </div>
      ) : (
        <>
          <div className="eggs" role="radiogroup" aria-label={t("hatch.title")}>
            {eggs.map((e) => (
              <button key={e.l} type="button" role="radio" aria-checked={line === e.l} className="egg" onClick={() => (setLine(e.l), play("tap"))}>
                <motion.div animate={line === e.l && !reduce ? { rotate: [0, -4, 4, 0] } : { rotate: 0 }} transition={{ duration: 0.5, repeat: line === e.l ? Infinity : 0, repeatDelay: 1.4 }}>
                  <Sprite canvas={e.idle} palette={e.pal} scale={3} />
                </motion.div>
                <b>{t(`line.${e.l}` as Key)}</b>
                <span>{t(`line.${e.l}.desc` as Key)}</span>
              </button>
            ))}
          </div>
          <div className="name-row">
            <label htmlFor="pet-name">{t("hatch.name")}</label>
            <div className="name-field">
              <input id="pet-name" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} />
              <button type="button" className="shuffle" onClick={shuffle}>
                {t("hatch.shuffle")}
              </button>
            </div>
          </div>
          <button type="button" className="hatch-go" onClick={hatch} disabled={!name.trim()}>
            {t("hatch.go")}
          </button>
        </>
      )}
    </main>
  );
}
