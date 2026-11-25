/**
 * How a spar ended (P7: out of Arena.tsx): the result, what it earned, and the check of the fight against X Layer.
 */
/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { PAID_SPARS_PER_DAY } from "@lingxi/world";
import {
  type CoachNote,
  type Fighter,
  type Partner,
  type Pet,
  type SparResult,
  coach,
  encodeResult,
  fighterOfMind,
  fighterOfPartner,
  stageOf,
  PRACTICE_SEEDS,
} from "@lingxi/game";
import { linkPrefix } from "../../game/links";
import { now } from "../../game/gameClock";
import { type FightState, levelOf } from "../../game/arenaFight";

import { programFor, useGame } from "../../game/store";
import { Chips } from "../parts";
import { chipsFor } from "../ruleText";
import { useLang } from "../../i18n";
import { play } from "../../game/sound";
import "../arena.css";
import "../rewind.css";
import { checkSparOnChain } from "../../game/battleCheck";
import { ChainCheck } from "../ChainCheck";
import { questSlots } from "../../game/tally";
import { linkToken } from "../../game/duelLinks";
import { FightRewind, otherSide } from "./Rewind";
import { type Lang, why } from "./shared";

export function Result({
  pet,
  partner,
  result,
  reward,
  practice = false,
  opponent,
  duel,
  cheer,
  instinct,
  daily = false,
  onDone,
  onRematch,
  onWatchAgain,
}: {
  pet: Pet;
  partner: Partner;
  result: SparResult;
  reward: number;
  practice?: boolean;
  opponent?: Fighter;
  duel?: FightState["duel"];
  cheer: boolean;
  instinct?: string;
  daily?: boolean;
  onDone: () => void;
  onRematch: () => void;
  onWatchAgain?: () => void;
}) {
  const [backLink, setBackLink] = useState("");
  const lang = useLang((s) => s.lang) as Lang;
  const learn = useGame((s) => s.learn);
  const swapLesson = useGame((s) => s.swapLesson);
  const [note, setNote] = useState<CoachNote | null>(null);
  const [taught, setTaught] = useState<"idle" | "done" | string>("idle");
  // the coach looks at the pet as it was in this fight; teaching afterwards does not re-run it
  const [asFought] = useState(pet);
  useEffect(() => {
    const pet = asFought;
    if (result.winner === 0) return;
    // the coach runs a few hundred practice spars; let the result paint first
    const id = setTimeout(() => {
      const stage = stageOf(pet, now());
      setNote(
        coach({
          result,
          side: 0,
          line: pet.line,
          stage,
          lessons: pet.lessons,
          level: levelOf(stage),
          memory: pet.brain,
          family: pet.family,
          instincts: pet.instincts,
          outside: pet.outside,
          growth: pet.growth,
          slots: questSlots(),
          opponent: opponent ?? fighterOfPartner(partner, result.version),
        }),
      );
    }, 60);
    return () => clearTimeout(id);
  }, [result, partner, opponent, asFought]);

  const title =
    result.winner === 0
      ? lang === "zh"
        ? `${pet.name}赢了！`
        : `${pet.name} won!`
      : result.winner === 1
        ? lang === "zh"
          ? `${partner.name.zh}赢了`
          : `${partner.name.en} won`
        : lang === "zh"
          ? "平手"
          : "A draw";
  return (
    <motion.div
      className="sp-result"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <h3>{title}</h3>
      {partner.id.startsWith("friend:") && (
        <p className="small">
          {lang === "zh" ? "和朋友的友谊赛，不发金币。" : "A friendly match with a friend's pet: no coins."}
        </p>
      )}
      {reward > 0 && <p className="sp-coins">{lang === "zh" ? `+${reward} 金币` : `+${reward} coins`}</p>}
      {practice && (
        <p className="small sp-practice">
          {lang === "zh"
            ? `今天 ${PAID_SPARS_PER_DAY} 场有奖切磋已经用完，这场算练习：不发金币，但任务、徽章和战绩照样记。明天再来。`
            : `Today's ${PAID_SPARS_PER_DAY} paid spars are used, so this one was practice: no coins, but it still counts for quests, badges and the record. More pay tomorrow.`}
        </p>
      )}
      {instinct && (
        <p className="small">
          {lang === "zh"
            ? `${pet.name}这一场用的是收养的本能「${instinct}」，所以不计战绩、不发金币。教练的建议是针对它自己的心智的，收养的大脑不会因为上课而改变。`
            : `${pet.name} fought this one with its adopted instinct, ${instinct}, so it doesn't count toward its record or earn coins. The coach's advice is for its own mind; lessons don't change an adopted brain.`}
        </p>
      )}
      {result.winner !== 0 && (
        <div className="sp-coach">
          <p className="label">{lang === "zh" ? "教练说" : "Coach says"}</p>
          {!note && <p className="small">{lang === "zh" ? "教练在看回放……" : "The coach is watching the replay…"}</p>}
          {note && <p>{why(note.key, pet.name, partner.name[lang], lang)}</p>}
          {note?.lesson && (
            <>
              {note.replace !== undefined && asFought.lessons[note.replace] ? (
                <>
                  <p>{lang === "zh" ? "它的心智满了。把这一课换掉：" : "Its mind is full. Swap this lesson out:"}</p>
                  <div className="sp-swap-out">
                    {(() => {
                      const c = chipsFor(
                        programFor(asFought.line, asFought.lessons, asFought.instincts ?? 0, asFought.growth),
                        asFought.lessons[note.replace]!,
                        lang,
                      );
                      return <Chips when={c.when} then={c.then} want={c.want} />;
                    })()}
                  </div>
                  <p>
                    {lang === "zh" ? "换成：" : "for: "}
                    <b>{note.lesson.label[lang]}</b>
                  </p>
                </>
              ) : (
                <p>
                  {lang === "zh" ? "试着教它：" : "Try teaching it: "}
                  <b>{note.lesson.label[lang]}</b>
                </p>
              )}
              <p className="small">
                {lang === "zh"
                  ? `在 ${PRACTICE_SEEDS} 场练习里，这样能赢 ${note.after} 场（现在是 ${note.before} 场）。`
                  : `In ${PRACTICE_SEEDS} practice spars this wins ${note.after} (it wins ${note.before} now).`}
              </p>
              {taught === "done" ? (
                <p className="sp-ok">{lang === "zh" ? "学会了！再来一场试试。" : "Learned! Try a rematch."}</p>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const r =
                      note.replace !== undefined
                        ? swapLesson(note.replace, note.lesson!.rule)
                        : learn(note.lesson!.rule);
                    setTaught(r.ok ? "done" : r.reason);
                  }}
                >
                  {note.replace !== undefined
                    ? lang === "zh"
                      ? "换成这一课"
                      : "Swap it in"
                    : lang === "zh"
                      ? "教它这个"
                      : "Teach this"}
                </button>
              )}
              {taught !== "idle" && taught !== "done" && (
                <p className="small sp-warn">
                  {taught === "full"
                    ? lang === "zh"
                      ? "它现在学不下更多了。长大后能学更多，或者先在心智里忘掉一条。"
                      : "Its mind is full for now. It can hold more as it grows, or forget a lesson in Mind first."
                    : lang === "zh"
                      ? "这条教不进去。"
                      : "That lesson didn't fit."}
                </p>
              )}
            </>
          )}
          {note && !note.lesson && (
            <p className="small">
              {lang === "zh"
                ? `教练的切磋课，不管是新教还是换掉一课，在 ${PRACTICE_SEEDS} 场练习里都赢不了更多。可以在心智里亲手教它一条规则。`
                : `None of the coach's fight lessons, taught new or swapped in, wins more of ${PRACTICE_SEEDS} practice spars here. You can teach it a rule of your own in Mind.`}
            </p>
          )}
        </div>
      )}
      {duel && (
        <div className="sp-duel">
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const url = `${linkPrefix("play.html")}duelr=${await linkToken(encodeResult(duel))}`;
              setBackLink(url);
              play("success");
              try {
                if (navigator.share) await navigator.share({ title: lang === "zh" ? "切磋结果" : "Our spar", url });
                else await navigator.clipboard.writeText(url);
              } catch {
                // dismissed; the link stays on screen
              }
            }}
          >
            {lang === "zh"
              ? `把结果发回给${partner.name.zh}的主人`
              : `Send the result back to ${partner.name.en}'s owner`}
          </button>
          {backLink && (
            <input
              className="sp-link"
              readOnly
              value={backLink}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={lang === "zh" ? "结果链接" : "Result link"}
            />
          )}
        </div>
      )}
      <div className="row">
        {!duel && (
          <button type="button" className="btn primary" onClick={onRematch}>
            {/* after the daily, a rematch is a practice spar (a seed of its own, not counted): it says so (B7) */}
            {daily
              ? lang === "zh"
                ? `和${partner.name.zh}练习一场`
                : `Practise against ${partner.name.en}`
              : lang === "zh"
                ? "再来一场"
                : "Rematch"}
          </button>
        )}
        {onWatchAgain && (
          <button type="button" className="btn" onClick={() => (play("tap"), onWatchAgain())}>
            {lang === "zh" ? "再看一遍" : "Watch it again"}
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "换个对手" : "Other partners"}
        </button>
      </div>
      <p className="small sp-fp">
        {lang === "zh"
          ? `回放指纹 ${result.digest} · 种子 ${result.seed}`
          : `Replay ${result.digest} · seed ${result.seed}`}
      </p>
      {/* both replay the pet's own mind, which did not fight this one */}
      {!instinct && (
        <SparChainCheck pet={asFought} partner={partner} opponent={opponent} result={result} cheer={cheer} />
      )}
      {!instinct && (
        <FightRewind pet={asFought} result={result} other={otherSide(partner, opponent, duel, result.version)} />
      )}
    </motion.div>
  );
}

/** A4 for a spar: re-run it with the brain read back from X Layer, and let the chain confirm every move. */
export function SparChainCheck({
  pet,
  partner,
  opponent,
  result,
  cheer,
}: {
  pet: Pet;
  partner: Partner;
  opponent?: Fighter;
  result: SparResult;
  cheer: boolean;
}) {
  return (
    <ChainCheck
      pet={pet}
      rounds={result.rounds.length}
      run={(petId, onProgress) => {
        const me = fighterOfMind(
          pet.name,
          {
            line: pet.line,
            lessons: pet.lessons,
            family: pet.family,
            instincts: pet.instincts,
            outside: pet.outside,
            growth: pet.growth,
          },
          levelOf(stageOf(pet, now())),
          pet.brain,
        );
        return checkSparOnChain({
          petId,
          me,
          them: () => opponent ?? fighterOfPartner(partner, result.version),
          result,
          cheer,
          onProgress,
        });
      }}
    />
  );
}
