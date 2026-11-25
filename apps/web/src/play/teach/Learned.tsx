/**
 * What the pet has learned (P7: out of Teach.tsx), and the last time each lesson decided.
 */
/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { CuteState } from "../CuteState";
import { useMemo, useState } from "react";
import { INPUT_FIELDS } from "@lingxi/brain";
import { type Frame, type Pet, lessonTrigger, type Trap, trapsAfter } from "@lingxi/game";
import { useLang, useT } from "../../i18n";
import { play } from "../../game/sound";
import { mindForPet, mindParts, useGame } from "../../game/store";
import { firesToday } from "../../game/lessonScore";
import { Icon } from "../icons";
import { Chips } from "../parts";
import { showMoment } from "../TryIt";
import { VALUE_NAMES, WANT_NAMES, chipsFor } from "../ruleText";
import "../teach.css";
import { now } from "../../game/gameClock";
import { TrapNote, specOf } from "./shared";

export function Learned({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const doArrange = useGame((s) => s.arrange);
  const [pending, setPending] = useState<{ index: number; move: "up" | "down"; traps: Trap[] } | null>(null);
  const arrange = (index: number, move: "up" | "down" | "forget") => {
    if (move === "forget") return doArrange(index, move);
    const next = pet.lessons.slice();
    const j = move === "up" ? index - 1 : index + 1;
    const a = next[index];
    const b = next[j];
    // up from the first or down from the last: there is nothing to swap with
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[j] = a;
    const traps = trapsAfter(specOf(pet), next);
    if (traps.length) {
      play("error");
      setPending({ index, move, traps });
      return;
    }
    setPending(null);
    doArrange(index, move);
  };
  const p = mindParts(pet)[0].program;
  // each lesson's score for today, from the day replayed (G1)
  const fires = useMemo(() => firesToday(pet, mindForPet(pet), now()), [pet]);
  if (!pet.lessons.length) return <CuteState who={{ pet, expression: "shy" }} text={t("teach.none")} />;
  return (
    <>
      {pending && (
        <div className="trap-confirm">
          <TrapNote pet={pet} traps={pending.traps} />
          <div className="row">
            <button type="button" className="btn" onClick={() => setPending(null)}>
              {t("teach.keepOrder")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                doArrange(pending.index, pending.move);
                setPending(null);
              }}
            >
              {t("teach.moveAnyway")}
            </button>
          </div>
        </div>
      )}
      <ol className="learned">
        {pet.lessons.map((r, i) => {
          const c = chipsFor(p, r, lang);
          const fire = fires[i];
          return (
            <li key={`${r.label}-${i}`}>
              <div className="rule-preview">
                <Chips when={c.when} then={c.then} want={c.want} />
                <span className="fires small">
                  {fire?.count
                    ? t("teach.fired", { n: fire.count })
                    : lessonTrigger(r).kind === "moment"
                      ? t("teach.firedWaits")
                      : t("teach.firedNone")}
                </span>
              </div>
              {fire?.last && <LastTime pet={pet} frame={fire.last} />}
              {!fire?.last && lessonTrigger(r).kind === "moment" && (
                <button
                  type="button"
                  className="text-link small see-moment"
                  onClick={() => showMoment(pet, r, t, lang === "zh" ? "zh" : "en")}
                >
                  {t("teach.seeMoment")}
                </button>
              )}
              <div className="mini">
                <button type="button" aria-label={t("teach.up")} disabled={i === 0} onClick={() => arrange(i, "up")}>
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={t("teach.down")}
                  disabled={i === pet.lessons.length - 1}
                  onClick={() => arrange(i, "down")}
                >
                  ▼
                </button>
                <button type="button" aria-label={t("teach.forget")} onClick={() => arrange(i, "forget")}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * The last moment today a lesson decided, shown again (G1 item 4, row B4): when it was, everything the pet sensed
 * that beat, and what it chose, from the day's log replayed.
 */
export function LastTime({ pet, frame }: { pet: Pet; frame: Frame }) {
  const t = useT();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  // the time on the pet's own clock; a word logged before times were kept has none, and none is shown
  const at =
    frame.at === null
      ? null
      : new Date(frame.at + pet.tzOffsetMin * 60_000).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        });
  // everything it sensed, leaving out "nothing happening" (no care, no event), which only says what was absent
  const sensed = INPUT_FIELDS.filter(
    (f) => !((f.name === "action" || f.name === "event") && frame.senses[f.name] === 0),
  )
    .map((f) => VALUE_NAMES[f.name]?.[lang][frame.senses[f.name as keyof typeof frame.senses]] ?? "")
    .filter(Boolean);
  return (
    <div className="last-time">
      <button
        type="button"
        className="text-link small"
        aria-expanded={open}
        onClick={() => (play("tap"), setOpen((o) => !o))}
      >
        {at === null ? t("teach.lastUntimed") : t("teach.lastAt", { time: at })}
      </button>
      {open && (
        <p className="small">
          {t("teach.lastSensed", { sensed: sensed.join(lang === "zh" ? "、" : ", ") })}
          {lang === "zh" ? "" : " "}
          {t("teach.lastDid", { then: WANT_NAMES[lang][frame.want] ?? "" })}
        </p>
      )}
    </div>
  );
}
