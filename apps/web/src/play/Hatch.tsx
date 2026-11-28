/** First run: pick one of three eggs, name it, watch it hatch. */

import { OnChainNote } from "../OnChainNote";
import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { SHELL, drawEgg, drawPet } from "@lingxi/art";
import { useHoldings } from "../game/holders";
import { markHatched } from "./afterHatch";
import { restoreFocus } from "./handoverFocus";
import { HolderPerkNote } from "./HolderPerk";

/** The gilded shell a TapeCode Test1 holder's eggs wear. */
const GILDED = { O: "#7A4E1A", o: "#B07A2A", D: "#E0A93A", d: "#F5C85A", m: "#FFE39A" };
import type { StarterLine } from "@lingxi/brain";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { INSTINCTS, type Instinct, composeProgram, instinctBits, nameFromBrain } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/palette";
import { Sprite } from "./Sprite";
import { useSaveFileUi } from "./saveFileUi";
import { useHatchDraft } from "./hatchDraft";
import { nameAfterChange, nameAfterComposition } from "./nameInput";
import "./hatch.css";

const LINES: readonly StarterLine[] = ["gentle", "bold", "curious"];

export function Hatch({ onHatch }: { onHatch: (line: StarterLine, name: string, instincts: number) => void }) {
  const t = useT();
  const { lang } = useLang();
  const reduce = useReducedMotion();
  // the choices live in a store of their own (hatchDraft.ts), so a first visit's hand-over to the full game keeps them
  const { line, draw, typed, cracking, instincts, update } = useHatchDraft();
  const setLine = (l: StarterLine) => update({ line: l });
  // the suggested name is read from the chosen egg's own circuit (PRD F14); once the player types, it is theirs
  const setCracking = (k: number) => update({ cracking: k });
  const circuit = useMemo(
    () => netlistBytes(compileProgram(composeProgram(line, [], instinctBits(instincts)))),
    [line, instincts],
  );
  const suggested = useMemo(() => nameFromBrain(circuit, draw), [circuit, draw]);
  const name = typed ?? suggested[lang === "zh" ? "zh" : "en"];
  const setName = (v: string) => update({ typed: v });
  const toggle = (k: Instinct) => {
    play("tap");
    const on = useHatchDraft.getState().instincts;
    update({ instincts: on.includes(k) ? on.filter((x) => x !== k) : [...on, k] });
  };
  const test1 = useHoldings((h) => h.held?.test1 === true);
  // the egg's shape and crack frames are the same for every line (only the palette differs), so they are drawn once (P3)
  const shape = useMemo(
    () => ({ idle: drawEgg("coral", 0), cracks: [0, 1, 2, 3].map((k) => drawEgg("coral", 0, k)) }),
    [],
  );
  const eggs = useMemo(
    () =>
      LINES.map((l) => ({
        l,
        // X2: a TapeCode Test1 holder's eggs come in a gilded shell (cosmetic only)
        pal: test1
          ? { ...SHELL, ...GILDED, x: PALETTE_OF[l].m, X: PALETTE_OF[l].d }
          : { ...SHELL, x: PALETTE_OF[l].m, X: PALETTE_OF[l].d },
        ...shape,
      })),
    [test1, shape],
  );
  const shuffle = () => {
    update({ typed: null, draw: useHatchDraft.getState().draw + 1 });
    play("tap");
  };
  const hatch = () => {
    play("hatch");
    const bits = instinctBits(instincts);
    // whoever receives the pet clears the draft once the pet exists, so the last crack frame stays until then
    const done = () => (markHatched(), onHatch(line, name, bits));
    if (reduce) {
      done();
      return;
    }
    let k = 0;
    setCracking(0);
    const id = setInterval(() => {
      k += 1;
      if (k > 4) {
        clearInterval(id);
        done();
      } else setCracking(k);
    }, 420);
  };
  const chosen = eggs.find((e) => e.l === line)!;
  // R8: the Hatch button goes with the form; the focus goes to the egg as it cracks, not back to the page
  const stage = useRef<HTMLDivElement>(null);
  const isCracking = cracking >= 0;
  useEffect(() => {
    if (isCracking) stage.current?.focus({ preventScroll: true });
  }, [isCracking]);
  // R58: drawn again by the full game after a first visit's handover, the screen puts the keyboard's place back
  const screen = useRef<HTMLElement>(null);
  useEffect(() => void restoreFocus(screen.current), []);
  return (
    <main ref={screen} className="hatch" aria-labelledby="hatch-h">
      <div className="hatch-head">
        <h1 id="hatch-h">{t("hatch.title")}</h1>
        <p>{t("hatch.sub")}</p>
      </div>
      {cracking >= 0 ? (
        <div className="hatch-stage" aria-live="polite" tabIndex={-1} ref={stage}>
          {/* R8: said when the focus arrives here, so the crack is not silence followed by "document" */}
          <span className="sr-only">{t("hatch.cracking", { name })}</span>
          {cracking < 4 ? (
            <motion.div animate={{ rotate: [0, -6, 6, -3, 0] }} transition={{ duration: 0.4 }}>
              <Sprite canvas={chosen.cracks[cracking]!} palette={chosen.pal} scale={5} />
            </motion.div>
          ) : (
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 18 }}
            >
              <Sprite
                canvas={drawPet(line, "baby", { expression: "sparkly" })}
                palette={PALETTE_OF[line]}
                scale={5}
                label={name}
              />
            </motion.div>
          )}
        </div>
      ) : (
        <>
          <div className="eggs" role="radiogroup" aria-label={t("hatch.title")}>
            {eggs.map((e) => (
              <button
                key={e.l}
                type="button"
                role="radio"
                aria-checked={line === e.l}
                className="egg"
                onClick={() => (setLine(e.l), play("tap"))}
              >
                <motion.div
                  animate={line === e.l && !reduce ? { rotate: [0, -4, 4, 0] } : { rotate: 0 }}
                  transition={{ duration: 0.5, repeat: line === e.l ? Infinity : 0, repeatDelay: 1.4 }}
                >
                  <Sprite canvas={e.idle} palette={e.pal} scale={3} />
                </motion.div>
                <b>{t(`line.${e.l}` as Key)}</b>
                <span>{t(`line.${e.l}.desc` as Key)}</span>
              </button>
            ))}
          </div>
          <HolderPerkNote />
          <fieldset className="instincts">
            <legend>{t("hatch.instincts")}</legend>
            <p>{t("hatch.instincts.sub")}</p>
            <div className="instinct-grid">
              {INSTINCTS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="switch"
                  aria-checked={instincts.includes(k)}
                  className="instinct"
                  onClick={() => toggle(k)}
                >
                  <span className="instinct-knob" aria-hidden="true" />
                  <b>{t(`instinct.${k}` as Key)}</b>
                  <small>{t(`instinct.${k}.desc` as Key)}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="name-row">
            <label htmlFor="pet-name">{t("hatch.name")}</label>
            <p className="name-from">
              {typed === null
                ? lang === "zh"
                  ? `从它的电路读出来的名字 · ${suggested.from}`
                  : `Read from its circuit · ${suggested.from}`
                : lang === "zh"
                  ? "你起的名字"
                  : "Your own name"}
            </p>
            <div className="name-field">
              <input
                id="pet-name"
                value={name}
                onChange={(e) => setName(nameAfterChange(e))}
                onCompositionEnd={(e) => setName(nameAfterComposition(e))}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="shuffle" onClick={shuffle}>
                {t("hatch.shuffle")}
              </button>
            </div>
          </div>
          {/* R32: the next step is always in view: the bar stays at the foot of the screen while the choices above it
              scroll, and comes to rest in its own place after the name; it names the pet it will hatch */}
          <div className="hatch-bar">
            <button type="button" className="hatch-go" onClick={hatch} disabled={!name.trim()}>
              {name.trim() ? t("hatch.goNamed", { name: name.trim() }) : t("hatch.go")}
            </button>
          </div>
          <button type="button" className="hatch-restore" onClick={() => useSaveFileUi.getState().show()}>
            {lang === "zh" ? "有存档文件？从文件恢复" : "Have a save file? Restore it"}
          </button>
        </>
      )}
      {cracking < 0 && <OnChainNote lang={lang as "en" | "zh"} />}
    </main>
  );
}
