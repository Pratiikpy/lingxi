/**
 * The sandbox (PRD F29): set up any situation and ask the pet's brain what it
 * would do, rule by rule, without touching the pet. With a lesson on the table,
 * the same situation is asked of the brain as it is now and as it would be with
 * the lesson, side by side. Nothing here is saved, logged or sent anywhere.
 */

import { useCallback, useMemo, useState } from "react";
import { INPUT_FIELDS, type Program, type Rule, encodeSenses, runBeat, stateBits } from "@lingxi/brain";
import { type Pet, halvesOf, skillRules } from "@lingxi/game";
import { useLang } from "../i18n";
import { programFor } from "../game/store";
import { Chips } from "./parts";
import { MOOD_NAMES, VALUE_NAMES, decidingChips } from "./ruleText";

type Lang = "en" | "zh";
type Senses = Record<(typeof INPUT_FIELDS)[number]["name"], number>;

const START: Senses = { hunger: 1, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 1 } as Senses;
const LABEL: Record<string, { en: string; zh: string }> = {
  hunger: { en: "Hunger", zh: "饥饿" },
  joy: { en: "Mood", zh: "心情" },
  energy: { en: "Energy", zh: "精力" },
  clean: { en: "Clean", zh: "干净" },
  time: { en: "Time", zh: "时间" },
  action: { en: "You do", zh: "你在做" },
  event: { en: "Happening", zh: "发生了" },
  owner: { en: "You", zh: "你" },
  trust: { en: "Trust", zh: "信任" },
  likesToys: { en: "Likes toys", zh: "喜欢玩具" },
  scared: { en: "Still shaken", zh: "还在害怕" },
  awake: { en: "Awake for", zh: "醒着" },
};

function ask(p: Program, senses: Senses, mem: Record<string, number>) {
  const bits = new Array(stateBits(p)).fill(0);
  let at = 0;
  for (const m of p.memory) {
    const n = m.kind === "flag" ? 1 : m.bits;
    for (let b = 0; b < n; b++) bits[at + b] = ((mem[m.name] ?? 0) >> b) & 1;
    at += n;
  }
  const r = runBeat(p, bits, encodeSenses(senses));
  return { rule: r.rule, mood: (r.out >> 3) & 3 };
}

function Answer({ title, program, senses, mem, lang }: { title: string; program: Program; senses: Senses; mem: Record<string, number>; lang: Lang }) {
  const a = ask(program, senses, mem);
  const c = decidingChips(program, a.rule, lang);
  return (
    <div className="sb-answer">
      <p className="label">{title}</p>
      <div className="rule-preview">
        <Chips when={c.when} then={c.then} want={c.want} />
      </div>
      <p className="small">
        {lang === "zh" ? "心情" : "Mood"}: {MOOD_NAMES[lang][a.mood]}
      </p>
    </div>
  );
}

export function Sandbox({ pet, trying }: { pet: Pet; trying?: Rule | null }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [senses, setSenses] = useState<Senses>(START);
  const [mem, setMem] = useState<Record<string, number>>({ trust: 3 });
  // a child decides by day with one parent's half and by night with the other's; skills count too (growth)
  const { line, family, instincts, growth, lessons } = pet;
  const time = senses.time;
  const programOf = useCallback(
    (ls: Rule[]) => {
      if (!family) return programFor(line, ls, instincts ?? 0, growth);
      const [a, b] = halvesOf(family, ls, skillRules(growth));
      return time === 1 || time === 2 ? a : b;
    },
    [line, family, instincts, growth, time],
  );
  const now = useMemo(() => programOf(lessons), [programOf, lessons]);
  const withLesson = useMemo(() => (trying ? programOf([trying, ...lessons]) : null), [programOf, trying, lessons]);
  return (
    <details className="sandbox">
      <summary>{lang === "zh" ? "沙盒：随便设个情况，看它会怎么做（不会改变它）" : "Sandbox: set up any situation and see what it would do (nothing changes)"}</summary>
      <div className="sb-grid">
        {INPUT_FIELDS.map((f) => (
          <label key={f.name}>
            <span>{LABEL[f.name]?.[lang] ?? f.name}</span>
            <select value={senses[f.name]} onChange={(e) => setSenses({ ...senses, [f.name]: Number(e.target.value) })}>
              {(VALUE_NAMES[f.name]?.[lang] ?? []).map((v, i) => (
                <option key={i} value={i}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        ))}
        {now.memory.map((m) => {
          const max = m.kind === "flag" ? 1 : (1 << m.bits) - 1;
          return (
            <label key={m.name}>
              <span>{LABEL[m.name]?.[lang] ?? m.label ?? m.name}</span>
              <select value={mem[m.name] ?? 0} onChange={(e) => setMem({ ...mem, [m.name]: Number(e.target.value) })}>
                {Array.from({ length: max + 1 }, (_, v) => (
                  <option key={v} value={v}>
                    {m.kind === "flag" ? (v ? "✓" : "–") : v}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div className="sb-answers">
        <Answer title={lang === "zh" ? "它现在会" : "As it is now"} program={now} senses={senses} mem={mem} lang={lang} />
        {withLesson && <Answer title={lang === "zh" ? "学了这一课以后" : "With this lesson"} program={withLesson} senses={senses} mem={mem} lang={lang} />}
      </div>
    </details>
  );
}
