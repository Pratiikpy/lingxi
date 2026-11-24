/**
 * Right after a lesson is taught, what brings it about (G1's light bulb, row B4; lightBulb.ts in @lingxi/game):
 *   event    the room stages the friend, toy or noise in the next beats (the store does it): go and watch
 *   care     the player is asked to give the care the lesson answers
 *   watched  it shows by itself while the owner is near: go and watch
 *   moment   it waits on the time of day or a need, so one tap shows what the pet would do then, read from its real
 *            mind and memory with nothing changed or logged, beside what it would have done without the lesson
 */

import { useEffect } from "react";
import type { Rule } from "@lingxi/brain";
import { type Pet, lessonTrigger, momentsFor } from "@lingxi/game";
import { type Key, useLang, useT } from "../i18n";
import { WANT_NAMES, chipsFor } from "./ruleText";
import { mindParts, programFor } from "../game/store";
import { tryLesson, useTrial } from "../game/tryIt";
import { play } from "../game/sound";

const COMING: Record<number, Key> = { 1: "try.friend", 2: "try.toy", 3: "try.scary" };
const same = (a: Rule, b: Rule) => JSON.stringify([a.when, a.then]) === JSON.stringify([b.when, b.then]);

/**
 * A moment lesson shown in the room: what the pet would do in that moment, and what it would have done without the
 * lesson. Nothing is changed or logged; it can be shown again at any time from the Learned list.
 */
export function showMoment(pet: Pet, lesson: Rule, t: ReturnType<typeof useT>, lang: "en" | "zh") {
  play("tap");
  const withIt = mindParts(pet);
  const withoutIt = mindParts({ ...pet, lessons: pet.lessons.filter((l) => !same(l, lesson)) });
  // each situation the lesson names, asked of the half of the mind that decides then (a child decides with one
  // parent's half by morning and day, the other's by evening and night), with and without the lesson
  const asked = momentsFor(lesson).map((senses) => {
    const pick = <T,>(parts: T[]) => ((senses.time === 1 || senses.time === 2 ? parts[0] : parts[1]) ?? parts[0])!;
    const part = pick(withIt);
    const without = pick(withoutIt);
    return {
      tried: tryLesson(part.program, pet.brain.slice(part.offset), lesson, senses),
      before: tryLesson(without.program, pet.brain.slice(without.offset), lesson, senses),
    };
  });
  // the moment shown: one where the lesson decides and changes what the pet does, else one where it decides
  const { tried, before } =
    asked.find((a) => a.tried.fired && a.before.want !== a.tried.want) ?? asked.find((a) => a.tried.fired) ?? asked[0]!;
  const then = (want: number) => WANT_NAMES[lang][want] ?? "";
  const line = tried.fired
    ? `${t("try.would", { then: then(tried.want) })}${before.want !== tried.want ? `${lang === "zh" ? "" : " "}${t("try.without", { then: then(before.want) })}` : ""}`
    : t("try.waits", { name: pet.name, then: then(tried.want) });
  useTrial.getState().stage(tried, lesson, line);
}

export function TryIt({ pet, lesson, onDone }: { pet: Pet; lesson: Rule; onDone: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang) === "zh" ? "zh" : "en";
  const trigger = lessonTrigger(lesson);
  // while it is on screen, a badge earned by the same teaching waits rather than covering it (B5)
  useEffect(() => {
    useTrial.setState({ offering: true });
    return () => useTrial.setState({ offering: false });
  }, []);
  const watch = () => {
    play("tap");
    useTrial.getState().watch();
    onDone();
  };
  const preview = () => {
    showMoment(pet, lesson, t, lang);
    onDone();
  };
  const when = () =>
    chipsFor(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth), lesson, lang).when.join(
      lang === "zh" ? "且" : " and ",
    );
  const text =
    trigger.kind === "event"
      ? t("try.event", { name: pet.name, coming: t(COMING[trigger.event]!) })
      : trigger.kind === "care"
        ? t("try.care", { name: pet.name, care: t(`try.care.${trigger.care}` as Key) })
        : trigger.kind === "watched"
          ? t("try.watched", { name: pet.name })
          : t("try.moment", { name: pet.name, when: when() });
  return (
    <div className="try-it" role="group" aria-label={t("try.title", { name: pet.name })}>
      <p>
        <b>{t("try.title", { name: pet.name })}</b>
      </p>
      <p className="small">{text}</p>
      <div className="row">
        {trigger.kind === "moment" ? (
          <button type="button" className="btn primary" onClick={preview} data-hint="try">
            {t("try.go")}
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={watch} data-hint="try">
            {t("try.watch")}
          </button>
        )}
        <button type="button" className="btn" onClick={() => (play("tap"), onDone())}>
          {t("try.later")}
        </button>
      </div>
    </div>
  );
}
