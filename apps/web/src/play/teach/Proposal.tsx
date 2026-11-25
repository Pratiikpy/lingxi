/**
 * A lesson proposed to the pet (P7: out of Teach.tsx): what it would do, what it costs, and whether the pet
 * takes it.
 */
/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { type Rule } from "@lingxi/brain";
import { type Pet, lessonCost, roomMakers, stageOf, trapsAfter } from "@lingxi/game";
import { useLang, useT } from "../../i18n";
import { libraryAvailable, shareLesson, usedLesson } from "../../game/library";
import { play } from "../../game/sound";
import { programFor, useGame } from "../../game/store";
import { Chips } from "../parts";
import { useTrial } from "../../game/tryIt";
import { chipsFor } from "../ruleText";
import "../teach.css";
import { now } from "../../game/gameClock";
import { CostLine, REASON_KEY, RulePreview, type Source, TrapNote, specOf } from "./shared";

export function Proposal({
  pet,
  rule,
  reply,
  source,
  swap: full,
  onDone,
  onLearned,
}: {
  pet: Pet;
  rule: Rule;
  reply?: string;
  source: Source;
  swap: boolean;
  onDone: () => void;
  onLearned: (rule: Rule) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const learn = useGame((s) => s.learn);
  const swapLesson = useGame((s) => s.swapLesson);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  // G7: a lesson too big for the taught budget is taught as a swap too, forgetting one that makes room
  const stage = stageOf(pet, now());
  const fitCheck = useMemo(() => {
    try {
      const spec = specOf(pet);
      return { fits: lessonCost(spec, rule, stage).fits, makers: roomMakers(spec, rule, stage) };
    } catch {
      return { fits: true, makers: [] as number[] };
    }
  }, [pet, rule, stage]);
  const tooBig = !fitCheck.fits;
  const swap = full || tooBig;
  // a full pet forgets the lesson the player picks, the newest unless they choose another (B2); when the lesson is too
  // big, the first one whose place makes room
  const [drop, setDrop] = useState(() => (tooBig ? (fitCheck.makers[0] ?? 0) : 0));
  const onTopTraps = trapsAfter(specOf(pet), [rule, ...pet.lessons]);
  const belowIsClean =
    onTopTraps.length > 0 && pet.lessons.length > 0 && trapsAfter(specOf(pet), [...pet.lessons, rule]).length === 0;
  const confirm = (at: "top" | "bottom" = "top") => {
    // Try it follows a lesson taught: a badge the teaching earns waits for it from this moment, not from Try it's first
    // paint, or it shows over Try it for a frame and leaves (B5); Try it clears the hold when it is answered
    useTrial.setState({ offering: true });
    const r = swap ? swapLesson(drop, rule) : learn(rule, at);
    if (!r.ok) useTrial.setState({ offering: false });
    if (r.ok) {
      play("success");
      if (source.kind === "library") void usedLesson(source.key);
      if (source.kind === "own" && share) void shareLesson(rule, pet.name);
      onLearned(rule);
      onDone();
    } else {
      play("error");
      setErr(t(REASON_KEY[r.reason] ?? "teach.error", { name: pet.name }));
    }
  };
  return (
    <motion.div
      className="proposal"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
    >
      {reply && <p className="reply">{reply}</p>}
      <p className="small">
        {t(
          source.kind === "school"
            ? "teach.becameSchool"
            : source.kind === "library"
              ? "teach.becameLibrary"
              : "teach.became",
        )}
      </p>
      <RulePreview pet={pet} rule={rule} />
      <CostLine pet={pet} rule={rule} />
      <TrapNote pet={pet} traps={onTopTraps} />
      {swap && (
        <fieldset className="swap-pick">
          <legend className="small sp-warn">
            {t(tooBig ? (fitCheck.makers.length ? "teach.swapRoom" : "teach.noRoom") : "teach.swapNote", {
              name: pet.name,
            })}
          </legend>
          {pet.lessons.map((l, i) => {
            const c = chipsFor(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth), l, lang);
            const makes = !tooBig || fitCheck.makers.includes(i);
            return (
              <label key={i} className={`swap-row${drop === i ? " on" : ""}${makes ? "" : " no-room"}`}>
                <input
                  type="radio"
                  name="swap-drop"
                  checked={drop === i}
                  disabled={!makes}
                  onChange={() => setDrop(i)}
                />
                <Chips when={c.when} then={c.then} want={c.want} />
                {tooBig && makes && <small className="makes-room">{t("teach.makesRoom")}</small>}
              </label>
            );
          })}
        </fieldset>
      )}
      {err && (
        <p className="err" role="alert">
          {err}
        </p>
      )}
      {source.kind === "own" && libraryAvailable() && (
        <label className="share-opt">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          {t("library.shareOpt", { name: pet.name })}
        </label>
      )}
      <div className="row">
        {belowIsClean && !swap && (
          <button type="button" className="btn primary" onClick={() => confirm("bottom")}>
            {t("teach.confirmBelow")}
          </button>
        )}
        <button
          type="button"
          className={`btn${belowIsClean && !swap ? "" : " primary"}`}
          onClick={() => confirm()}
          disabled={tooBig && !fitCheck.makers.length}
          data-hint="teach"
        >
          {t(swap ? "teach.confirmSwap" : "teach.confirm")}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t("teach.retry")}
        </button>
      </div>
    </motion.div>
  );
}
