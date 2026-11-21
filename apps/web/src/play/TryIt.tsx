/**
 * H5: right after a lesson, one tap stages its situation and the room shows the pet acting on it, with the rule that
 * decided (game/tryIt.ts). The pet's real memory is read and nothing about it changes.
 */

import type { Rule } from "@lingxi/brain";
import type { Pet } from "@lingxi/game";
import { useLang, useT } from "../i18n";
import { WANT_NAMES } from "./ruleText";
import { mindParts } from "../game/store";
import { stageFor, tryLesson, useTrial } from "../game/tryIt";
import { play } from "../game/sound";

export function TryIt({ pet, lesson, onDone }: { pet: Pet; lesson: Rule; onDone: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang) === "zh" ? "zh" : "en";
  const go = () => {
    play("tap");
    // a child decides with one parent's half by morning and day, the other's by evening and night
    const parts = mindParts(pet);
    const time = stageFor(lesson).time;
    const part = (time === 1 || time === 2 ? parts[0] : parts[1]) ?? parts[0]!;
    const tried = tryLesson(part.program, pet.brain.slice(part.offset), lesson);
    const line = t(tried.fired ? "try.did" : "try.waits", { name: pet.name, then: WANT_NAMES[lang][tried.want] ?? "" });
    useTrial.getState().stage(tried, lesson, line);
    onDone();
  };
  return (
    <div className="try-it" role="group" aria-label={t("try.title", { name: pet.name })}>
      <p>
        <b>{t("try.title", { name: pet.name })}</b>
      </p>
      <p className="small">{t("try.how", { name: pet.name })}</p>
      <div className="row">
        <button type="button" className="btn primary" onClick={go} data-hint="try">
          {t("try.go")}
        </button>
        <button type="button" className="btn" onClick={() => (play("tap"), onDone())}>
          {t("try.later")}
        </button>
      </div>
    </div>
  );
}
