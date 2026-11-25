/**
 * What the teaching parts share (P7: out of Teach.tsx): a lesson previewed on the pet, its cost in gates,
 * the gate meter, and the traps a lesson walks into.
 */
/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { useMemo } from "react";
import { type Rule } from "@lingxi/brain";
import { PET_SCHOOL, type Pet, type Trap, brainSize, lessonCost, stageOf } from "@lingxi/game";
import { useLang, useT, type Key } from "../../i18n";
import { type TeachingState } from "../../game/api";
import { mindParts } from "../../game/store";
import { Chips } from "../parts";
import { chipsFor } from "../ruleText";
import "../teach.css";
import { now } from "../../game/gameClock";

export const REASON_KEY: Record<string, Key> = {
  full: "teach.full",
  duplicate: "teach.dup",
  tooBig: "teach.tooBig",
  invalid: "teach.invalid",
  busy: "teach.busy",
  resting: "teach.resting",
  yourShare: "teach.yourShare",
  offline: "teach.offline",
  error: "teach.error",
};

/** Why teaching in words is not on offer, in the player's language (H11). */
export const NOT_ON_OFFER: Record<Exclude<TeachingState, "ready">, Key> = {
  noServer: "teach.noServer",
  offline: "teach.offline",
  unreachable: "teach.unreachable",
  off: "teach.off",
};

export function RulePreview({ pet, rule }: { pet: Pet; rule: Rule }) {
  const { lang } = useLang();
  const c = chipsFor(mindParts(pet)[0]!.program, rule, lang);
  return (
    <div className="rule-preview">
      <Chips when={c.when} then={c.then} want={c.want} />
    </div>
  );
}

/** Where a proposed lesson came from: Pet School, the library (by key), or the owner's own words or blocks. */
export type Source = { kind: "school" } | { kind: "library"; key: string } | { kind: "own" };

/** The parts of a pet its brain is built from. */
export const specOf = (pet: Pet) => ({
  line: pet.line,
  lessons: pet.lessons,
  family: pet.family,
  instincts: pet.instincts,
  outside: pet.outside,
  growth: pet.growth,
});

/**
 * The same parts as one object that stays the same while they do: a pet changes every beat, its brain only when one
 * of these does, so what is worked out from the brain is worked out again only then.
 */
export function useSpec(pet: Pet) {
  const { line, lessons, family, instincts, outside, growth } = pet;
  // the pet's skills too: its Mind skills widen the budget it is measured against (G7)
  return useMemo(
    () => ({ line, lessons, family, instincts, outside, growth }),
    [line, lessons, family, instincts, outside, growth],
  );
}

/** What a lesson costs in gates against the stage's taught budget, and what sharing logic saves (PRD F6, G7). */
export function CostLine({ pet, rule }: { pet: Pet; rule: Rule }) {
  const t = useT();
  const spec = useSpec(pet);
  const stage = stageOf(pet, now());
  const c = useMemo(() => {
    try {
      return lessonCost(spec, rule, stage);
    } catch {
      return null;
    }
  }, [spec, rule, stage]);
  if (!c) return null;
  return (
    <p className={`cost${c.fits ? "" : " over"}`}>
      {/* D3: when sharing saves gates, the line gives the lesson alone and what it adds, so its sums add up */}
      {c.saved > 0
        ? t("teach.costShared", { alone: c.alone, adds: c.adds, taught: c.taught, max: c.taughtMax })
        : t("teach.cost", { adds: c.adds, taught: c.taught, max: c.taughtMax })}
      {c.taught > c.taughtMax && (
        <> {t("teach.over", { n: c.taught - c.taughtMax, stage: t(`stage.${stage}` as Key) })}</>
      )}
    </p>
  );
}

/** The gates its lessons use against what its stage and Mind skills allow (G7), and the whole circuit beside it. */
export function GateMeter({ pet }: { pet: Pet }) {
  const t = useT();
  const spec = useSpec(pet);
  const stage = stageOf(pet, now());
  const size = useMemo(() => brainSize(spec, stage), [spec, stage]);
  const label = t("teach.gates", { n: size.taught, max: size.taughtMax });
  return (
    <div className={`gates${size.taught >= size.taughtMax ? " full" : ""}`} title={t("teach.gatesWhy")}>
      <span>
        {label} <small>{t("teach.wholeBrain", { n: size.gates, max: size.max })}</small>
      </span>
      <i role="meter" aria-valuemin={0} aria-valuemax={size.taughtMax} aria-valuenow={size.taught} aria-label={label}>
        <i style={{ transform: `scaleX(${Math.min(1, size.taught / Math.max(1, size.taughtMax))})` }} />
      </i>
    </div>
  );
}

/** A lesson order that takes stars from another lesson, said plainly with the rule that gets in the way (PRD F7). */
export function TrapNote({ pet, traps }: { pet: Pet; traps: Trap[] }) {
  const t = useT();
  const { lang } = useLang();
  if (!traps.length) return null;
  const p = mindParts(pet)[0]!.program;
  return (
    <div className="trap" role="alert">
      <p>{t("teach.trap", { n: traps.length })}</p>
      <ul>
        {traps.slice(0, 3).map((tr, i) => {
          const c = chipsFor(p, tr.blocker, lang);
          const school = PET_SCHOOL.find((l) => l.id === tr.victim)!;
          return (
            <li key={i}>
              <span className="rule-preview">
                <Chips when={c.when} then={c.then} want={c.want} />
              </span>
              <span>{t("teach.trapWhy", { goal: tr.goal.say[lang], lesson: school.say[lang] })}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
