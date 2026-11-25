/**
 * A spar as it happens (P7: out of Arena.tsx), round by round.
 */
/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useBadges } from "../../game/badges";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FLY, drawFly, drawPet, type Expression, type Outfit, wearOverlay } from "@lingxi/art";
import { outfitOf } from "@lingxi/world";
import { MAX_HP, type Pet, sparMods } from "@lingxi/game";
import { SILICON } from "@lingxi/art";
import {
  BEHEMOTH_STEPS_PER_ROUND,
  SPAR_FIRST_ROUND_MS,
  SPAR_FIRST_WIN_COINS,
  SPAR_ROUND_MS,
  SPAR_WIN_COINS,
  behemothAt,
} from "@lingxi/game";
import { type FightState } from "../../game/arenaFight";

import { useDaily } from "../../game/daily";
import { useLang } from "../../i18n";
import { useSpar } from "../../game/spar";
import { useWorld } from "../../game/world";
import { HOME, ROOMS } from "@lingxi/world";
import { play } from "../../game/sound";
import { type PetStage } from "../../scene/palette";
import "../arena.css";
import "../rewind.css";
import { noteEvent, noteTally } from "../../game/tally";
import { markLoss } from "../../game/comfort";
import { Result } from "./Result";
import { ReplayResult } from "./Rewind";
import { type Lang, MOVE_NAMES, NO_OUTFIT, PetArt, coloursOf } from "./shared";

export function FightView({
  pet,
  self,
  partner,
  result,
  cheer,
  opponent,
  duel,
  daily = false,
  replay = false,
  instinct,
  boostCoins = 0,
  boosted = false,
  onDone,
  onRematch,
  onWatchAgain,
}: FightState & {
  pet?: Pet;
  self: { name: string; line: Pet["line"]; stage: PetStage };
  replay?: boolean;
  onDone: () => void;
  onRematch: () => void;
  onWatchAgain?: () => void;
}) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const finished = shown >= result.rounds.length;
  const round = shown > 0 ? result.rounds[shown - 1]! : null;
  // each side's own full health (a skill or a bag item can make it more than MAX_HP), so the bar never runs past its end
  const full: [number, number] = result.maxHp ?? [MAX_HP, MAX_HP];
  const hp: [number, number] = round ? round.hp : full;
  const stage = self.stage;
  const otherName = partner.name[lang];
  const roomIndex = useWorld((s) => s.world.room);
  const backdrop = (ROOMS[roomIndex] ?? ROOMS[HOME]!).bgs.day;

  const settled = useRef(false);
  const growth = pet?.growth;
  const [reward, setReward] = useState(0);
  const [practice, setPractice] = useState(false);
  const [dailyNote, setDailyNote] = useState<"best" | "same" | null>(null);
  // a replay watched to its end (quests count it)
  const replaySeen = useRef(false);
  useEffect(() => {
    if (!finished || !replay || replaySeen.current) return;
    replaySeen.current = true;
    noteEvent("replay-watched");
  }, [finished, replay]);
  // the fight is settled as its last round is shown: once, whatever changes afterwards
  const settle = () => {
    if (settled.current || replay) return;
    settled.current = true;
    // a win by an adopted brain is the brain's, not the pet's: no record, badge or coins
    if (instinct) return;
    const outcome = result.winner === 0 ? "w" : result.winner === 1 ? "l" : "d";
    const first = useSpar.getState().note(partner.id, outcome);
    if (daily) {
      const margin = result.rounds.at(-1) ? result.rounds.at(-1)!.hp[0] - result.rounds.at(-1)!.hp[1] : 0;
      const newBest = useDaily.getState().record(margin, outcome === "w");
      setDailyNote(newBest ? "best" : "same");
    }
    noteTally("SPAR");
    if (partner.id.startsWith("friend:") || partner.look === "behemoth") noteEvent("spar-peer");
    if (outcome === "l") markLoss();
    if (outcome === "w") useBadges.getState().note("sparWins");
    if (outcome === "w") noteTally("SPAR_WIN");
    if (outcome === "w" && partner.look === "behemoth") useBadges.getState().note("behemothWins");
    // Spar skills (plan 4.4): more for a win, and something even for a loss; friendly matches pay nothing, as before
    const skill = sparMods(growth);
    // G6: the day's first PAID_SPARS_PER_DAY paying spars pay; after that a spar is practice, counted but unpaid
    const owed = partner.id.startsWith("friend:")
      ? 0
      : outcome === "w"
        ? SPAR_WIN_COINS + (first ? SPAR_FIRST_WIN_COINS : 0) + skill.winCoins
        : outcome === "l"
          ? skill.lossCoins + boostCoins
          : 0;
    if (owed > 0) {
      const paid = useWorld.getState().paySpar(owed);
      setReward(paid);
      setPractice(paid === 0);
      if (paid > 0 && outcome === "w") play("success");
    }
  };

  const settleOnce = useEffectEvent(settle);
  // each round is shown after the last one, and the last one settles the fight
  useEffect(() => {
    if (finished) return;
    const id = setTimeout(
      () => {
        const r = result.rounds[shown]!;
        play(r.hits[0] || r.hits[1] ? "pop" : "tap");
        setShown(shown + 1);
        if (shown + 1 >= result.rounds.length) settleOnce();
      },
      shown === 0 ? SPAR_FIRST_ROUND_MS : reduce ? 450 : SPAR_ROUND_MS,
    );
    return () => clearTimeout(id);
  }, [shown, finished, result, reduce]);
  const face = (side: 0 | 1): Expression => {
    if (finished) return result.winner === side ? "proud" : result.winner === -1 ? "happy" : "sad";
    if (!round) return "neutral";
    if (round.hits[1 - side]! >= 14) return "startled";
    if (round.moves[side] === "rest") return "sleepy";
    if (round.moves[side] === "snack") return "munch";
    if (round.moves[side] === "charm" || round.moves[side] === "gift") return "love";
    return round.moods[side]! >= 2 ? "sparkly" : round.moods[side] === 0 ? "sulk" : "neutral";
  };
  const myFace = face(0);
  const theirFace = face(1);
  const form = pet?.form;
  const mine = useMemo(
    () => drawPet(self.line, stage, { expression: myFace, ...(form && !replay ? { form } : {}) }),
    [self.line, stage, myFace, form, replay],
  );
  // our own pet fights in its outfit (looks only)
  const world = useWorld((s) => s.world);
  const worn = pet && !replay ? (outfitOf(world, String(pet.bornAt)) as Outfit) : NO_OUTFIT;
  const mineWorn = useMemo(
    () => (worn.head || worn.face || worn.held ? wearOverlay(mine, self.line, stage, worn, 0, form) : undefined),
    [mine, self.line, stage, worn, form],
  );
  // Behemoth's lamps show the number its CPU holds this round
  const theirsWorn = useMemo(
    () =>
      partner.look === "behemoth"
        ? wearOverlay(
            drawPet(partner.line, partner.stage, {}),
            partner.line,
            partner.stage,
            { head: `b:lamps${behemothAt(shown * BEHEMOTH_STEPS_PER_ROUND).acc}` },
            0,
          )
        : undefined,
    [partner.look, partner.line, partner.stage, shown],
  );
  const flap = !!round && round.moves[1] === "pounce";
  const theirs = useMemo(
    () =>
      partner.look === "fly"
        ? drawFly({ flap, hurt: theirFace === "startled" || theirFace === "sad" })
        : drawPet(partner.line, partner.stage, { expression: theirFace }),
    [partner.look, partner.line, partner.stage, flap, theirFace],
  );

  return (
    <div className="sp-fight">
      <div className="sp-head">
        <span>{lang === "zh" ? `第 ${Math.max(1, shown)} / 16 回合` : `Round ${Math.max(1, shown)} of 16`}</span>
        {/* B7: the daily is marked as the daily while it is fought */}
        {daily && <span className="sp-cheering">{lang === "zh" ? "今日挑战" : "Today's challenge"}</span>}
        {cheer && <span className="sp-cheering">{lang === "zh" ? "你在加油" : "You're cheering"}</span>}
        {instinct && (
          <span className="sp-cheering">{lang === "zh" ? `本能：${instinct}` : `Instinct: ${instinct}`}</span>
        )}
        {boosted && !replay && (
          <span className="sp-cheering">{lang === "zh" ? "用上了备好的加成" : "Bonus from the bag"}</span>
        )}
        {!finished && (
          <button type="button" className="link" onClick={() => setShown(result.rounds.length)}>
            {lang === "zh" ? "跳到结果" : "Skip to result"}
          </button>
        )}
      </div>
      <div
        className="sp-ring"
        aria-live="polite"
        style={{ backgroundImage: `linear-gradient(rgba(255,253,248,0.05), rgba(43,33,64,0.18)), url(${backdrop})` }}
      >
        {([0, 1] as const).map((side) => (
          <div key={side} className={`sp-fighter side-${side}`}>
            <div className="sp-bar">
              <b>{side === 0 ? self.name : otherName}</b>
              <span
                className="sp-hp"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={full[side]}
                aria-valuenow={hp[side]}
                aria-label={lang === "zh" ? "体力" : "health"}
              >
                <i style={{ transform: `scaleX(${Math.min(1, hp[side] / full[side])})` }} />
              </span>
            </div>
            <motion.div
              key={`${side}-${shown}`}
              className="sp-body"
              animate={
                round && round.hits[1 - side]! > 0 && !reduce
                  ? { x: [0, side === 0 ? -6 : 6, 0, side === 0 ? -3 : 3, 0] }
                  : round && round.moves[side] === "pounce" && !reduce
                    ? { x: [0, side === 0 ? 14 : -14, 0] }
                    : {}
              }
              transition={{ duration: 0.38 }}
            >
              <PetArt
                canvas={side === 0 ? mine : theirs}
                line={side === 0 ? self.line : partner.line}
                palette={
                  side === 1 && partner.look === "fly"
                    ? FLY
                    : side === 1 && partner.look === "behemoth"
                      ? SILICON
                      : side === 1
                        ? coloursOf(partner)
                        : undefined
                }
                scale={4}
                overlay={side === 0 ? mineWorn : theirsWorn}
              />
            </motion.div>
            <AnimatePresence>
              {round && round.hits[1 - side]! > 0 && (
                <motion.span
                  key={`hit-${shown}`}
                  className="sp-pop"
                  initial={{ opacity: 0, y: 0 }}
                  animate={{ opacity: 1, y: -18 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  −{round.hits[1 - side]}
                </motion.span>
              )}
            </AnimatePresence>
            <span className="sp-move">{round ? MOVE_NAMES[round.moves[side]!][lang === "zh" ? 1 : 0] : "…"}</span>
          </div>
        ))}
      </div>
      {finished && dailyNote && (
        <p className="sp-daily-note">
          {dailyNote === "best"
            ? lang === "zh"
              ? "这是你今天每日挑战的最好成绩。"
              : "Your best in today's challenge so far."
            : lang === "zh"
              ? "没有超过今天的最好成绩。教它点新东西再试。"
              : "Not better than your best today. Teach it something and try again."}
          {/* the daily is one fight for one mind: the same mind fights it the same way, so a retry starts from its card */}
          {lang === "zh"
            ? " 每日挑战对同一个心智永远是同一场；教了新东西后，从每日挑战卡片再来。"
            : " The daily is the same fight for the same mind; after teaching it something, try again from the daily card."}
        </p>
      )}
      {finished &&
        (replay || !pet ? (
          <ReplayResult self={self} partner={partner} result={result} onDone={onDone} />
        ) : (
          <Result
            pet={pet}
            partner={partner}
            result={result}
            reward={reward}
            practice={practice}
            opponent={opponent}
            duel={duel}
            cheer={cheer}
            instinct={instinct}
            daily={daily}
            onDone={onDone}
            onRematch={onRematch}
            {...(onWatchAgain ? { onWatchAgain } : {})}
          />
        ))}
    </div>
  );
}
