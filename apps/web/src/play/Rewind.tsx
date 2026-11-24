/**
 * Rewind (PRD F11): scrub back through today and see why the pet did what it
 * did. Every moment is a real replay of its logged senses through the brain it
 * had then; the strip is coloured by what it chose, and the jump buttons stop at
 * care, events and every change of mind.
 */

import { useMemo, useState } from "react";
import { type Frame, type Pet, momentsOf, rewind, ruleSource, strongestHabit, tellMoment } from "@lingxi/game";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { mindForPet } from "../game/store";
import { Chips } from "./parts";
import { MOOD_NAMES, VALUE_NAMES, WANT_COLORS, WANT_NAMES, decidingChips } from "./ruleText";
import "./rewind.css";

type Lang = "en" | "zh";
const DAY = 24 * 60;

const SOURCE: Record<ReturnType<typeof ruleSource>, { en: string; zh: string }> = {
  taught: { en: "something you taught it", zh: "你教它的" },
  instinct: { en: "an instinct it hatched with", zh: "它天生的本能" },
  born: { en: "how its egg line is born", zh: "它这一系生来就会的" },
  default: { en: "nothing matched, so its default", zh: "没有条件符合，按它的默认" },
  outside: { en: "the instinct circuit it was taught", zh: "它学会的本能电路" },
};

const MEMORY_NAMES: Record<string, { en: string; zh: string }> = {
  trust: { en: "trust", zh: "信任" },
  likesToys: { en: "likes toys", zh: "喜欢玩具" },
  scared: { en: "still shaken", zh: "还在害怕" },
  awake: { en: "awake for", zh: "醒着" },
};

function clock(f: Frame, lang: Lang): string {
  if (f.at !== null)
    return new Date(f.at).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return VALUE_NAMES.time![lang][f.senses.time] ?? "";
}

/** What it sensed, leaving out the quiet defaults so the interesting senses stand out. */
function sensed(f: Frame, lang: Lang): string[] {
  const s = f.senses;
  const v = (k: string, i: number) => VALUE_NAMES[k]![lang][i]!;
  const out = [v("hunger", s.hunger), v("joy", s.joy), v("energy", s.energy), v("clean", s.clean), v("owner", s.owner)];
  if (s.action) out.unshift(v("action", s.action));
  if (s.event) out.unshift(v("event", s.event));
  return out;
}

function memoryOf(f: Frame, lang: Lang): string[] {
  const p = f.program;
  let bit = f.half === 1 ? f.memory.length - p.memory.reduce((n, m) => n + (m.kind === "flag" ? 1 : m.bits), 0) : 0;
  return p.memory.map((m) => {
    const bits = m.kind === "flag" ? 1 : m.bits;
    let v = 0;
    for (let b = 0; b < bits; b++) v |= (f.memory[bit + b] ? 1 : 0) << b;
    bit += bits;
    const name = MEMORY_NAMES[m.name]?.[lang] ?? m.label ?? m.name;
    return m.kind === "flag" ? `${name} ${v ? "✓" : "–"}` : `${name} ${v}/${(1 << bits) - 1}`;
  });
}

export function RewindPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  // how many days back from the newest moment (each "day" is 24 hours of the log)
  const [day, setDay] = useState(0);
  const days = Math.max(1, Math.ceil(pet.pendingLog.length / DAY));
  const frames = useMemo(
    () => rewind(pet, mindForPet(pet), DAY, day * DAY),
    // the log grows by a word every beat, so the pet changing and the log changing come at the same pace
    [pet, day],
  );
  const moments = useMemo(() => momentsOf(frames), [frames]);
  const [at, setAt] = useState<number | null>(null);
  const strip = useMemo(() => {
    const runs: string[] = [];
    let start = 0;
    for (let i = 1; i <= frames.length; i++) {
      if (i < frames.length && frames[i]!.want === frames[start]!.want) continue;
      runs.push(
        `${WANT_COLORS[frames[start]!.want]} ${((start / frames.length) * 100).toFixed(2)}% ${((i / frames.length) * 100).toFixed(2)}%`,
      );
      start = i;
    }
    return `linear-gradient(90deg, ${runs.join(", ")})`;
  }, [frames]);
  if (!frames.length) return null;
  const k = Math.min(at ?? frames.length - 1, frames.length - 1);
  const f = frames[k]!;
  const chips = f.outside
    ? lang === "zh"
      ? { when: ["它学会的本能电路想做点什么"], then: WANT_NAMES.zh[f.want] ?? "", want: f.want }
      : { when: ["its taught instinct circuit wanted something"], then: WANT_NAMES.en[f.want] ?? "", want: f.want }
    : decidingChips(f.program, f.rule, lang);
  const jump = (dir: -1 | 1) => {
    const next = dir < 0 ? [...moments].reverse().find((m) => m < k) : moments.find((m) => m > k);
    if (next === undefined) return;
    play("tap");
    setAt(next);
  };
  const src = ruleSource(f);

  return (
    <div className="chainpanel rewind">
      <p className="label">
        {day === 0
          ? lang === "zh"
            ? "倒带：最近一天它为什么这么做"
            : "Rewind: why it did what it did, the last 24 hours"
          : lang === "zh"
            ? `倒带：${day} 天前`
            : `Rewind: ${day} ${day === 1 ? "day" : "days"} earlier`}
      </p>
      {days > 1 && (
        <div className="rw-days">
          <button
            type="button"
            className="link"
            disabled={day >= days - 1}
            onClick={() => (play("tap"), setDay((d) => d + 1), setAt(null))}
          >
            {lang === "zh" ? "‹ 更早一天" : "‹ Earlier day"}
          </button>
          <button
            type="button"
            className="link"
            disabled={day === 0}
            onClick={() => (play("tap"), setDay((d) => d - 1), setAt(null))}
          >
            {lang === "zh" ? "更晚一天 ›" : "Later day ›"}
          </button>
        </div>
      )}
      <div className="rw-track">
        <div className="rw-strip" style={{ backgroundImage: strip }} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={k}
          onChange={(e) => setAt(Number(e.target.value))}
          aria-label={lang === "zh" ? "拖动回看" : "Scrub through the day"}
          aria-valuetext={`${clock(f, lang)} · ${WANT_NAMES[lang][f.want]}`}
        />
      </div>
      <div className="rw-nav">
        <button type="button" className="btn" onClick={() => jump(-1)} disabled={!moments.some((m) => m < k)}>
          {lang === "zh" ? "‹ 上一个时刻" : "‹ Previous moment"}
        </button>
        <b className="rw-clock">{clock(f, lang)}</b>
        <button type="button" className="btn" onClick={() => jump(1)} disabled={!moments.some((m) => m > k)}>
          {lang === "zh" ? "下一个时刻 ›" : "Next moment ›"}
        </button>
      </div>
      <div className="rw-card" aria-live="polite">
        <p className="rw-say" style={{ borderColor: WANT_COLORS[f.want] }}>
          “{tellMoment(f, lang, strongestHabit(pet.traits))}”
          <span>
            {lang === "zh" ? "心情" : "Mood"}: {MOOD_NAMES[lang][f.mood]}
            {f.half !== undefined &&
              ` · ${f.half === 0 ? (lang === "zh" ? "白天那一半" : "its day half") : lang === "zh" ? "夜里那一半" : "its night half"}`}
          </span>
        </p>
        <dl className="rw-rows">
          <dt>{lang === "zh" ? "它感觉到" : "It sensed"}</dt>
          <dd>
            {sensed(f, lang).map((s, i) => (
              <span key={i} className="chip">
                {s}
              </span>
            ))}
          </dd>
          <dt>{lang === "zh" ? "触发的规则" : "The rule that fired"}</dt>
          <dd className="rw-rule">
            <Chips when={chips.when} then={chips.then} want={chips.want} />
            <small>{SOURCE[src][lang]}</small>
          </dd>
          <dt>{lang === "zh" ? "它记得" : "It remembered"}</dt>
          <dd className="rw-mem">{memoryOf(f, lang).join(" · ")}</dd>
        </dl>
      </div>
      <p className="small">
        {lang === "zh"
          ? `共 ${frames.length} 个时刻，全部用它当时的电路重放得出。`
          : `${frames.length} moments, each replayed through the circuit it had at the time.`}
      </p>
    </div>
  );
}
