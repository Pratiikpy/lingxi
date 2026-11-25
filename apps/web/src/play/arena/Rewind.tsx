/**
 * A spar replayed (P7: out of Arena.tsx): each exchange in words, what the pet chose and what it made, and the
 * replay's result.
 */
/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  type Fighter,
  MOVES,
  type Move,
  type Partner,
  type Pet,
  type SparResult,
  type SparVersion,
  halvesOf,
  rewindFight,
  ruleSource,
  type Exchange,
  type Mind,
  SPAR_PUNISH,
  duelPetMind,
  exchangesOf,
  partnerMind,
  skillRules,
} from "@lingxi/game";
import { type FightState } from "../../game/arenaFight";

import { programFor } from "../../game/store";
import { Chips } from "../parts";
import { MOVE_NAMES as MOVE_LABEL, WANT_COLORS, decidingChips } from "../ruleText";
import { useLang } from "../../i18n";
import { play } from "../../game/sound";
import "../arena.css";
import "../rewind.css";
import { type Lang, OPEN, RULE_SOURCE } from "./shared";

/** Why a move made differs from the move the brain chose: not enough stamina, or a pounce slipped into a tap. */
export function changedNote(chose: number, made: Move, lang: Lang): string {
  return lang === "zh"
    ? `大脑选了${MOVE_LABEL.zh[chose]}，但${made === "rest" ? "力气不够出这一招，只能休息" : "扑空了，变成轻拍"}。`
    : `Its brain chose ${MOVE_LABEL.en[chose]}, but ${made === "rest" ? "it did not have the stamina for that, so it rested" : "the pounce slipped into a tap"}.`;
}

/** The other side of a fight as the rewind reads it: its name, and its mind when it is a pet's (not a fly's or Behemoth's). */
export function otherSide(
  partner: Partner,
  opponent: Fighter | undefined,
  duel: FightState["duel"],
  version: SparVersion,
): { name: { en: string; zh: string }; mind: Mind | null; memory?: number[] } {
  if (duel) {
    const m = duelPetMind(duel.challenge.from);
    return { name: partner.name, mind: m?.mind ?? null, ...(m?.memory ? { memory: m.memory } : {}) };
  }
  // a fighter brought in from elsewhere (a fly link, Behemoth) has no pet mind to rewind
  return { name: partner.name, mind: opponent ? null : partnerMind(partner, version) };
}

/** One exchange in words: what LX-SPAR/2's rules did with the round's two moves. */
export function exchangeLine(e: Exchange, names: [string, string], lang: Lang): string {
  const fav = names[e.by];
  const oth = names[e.by === 0 ? 1 : 0];
  const zh = lang === "zh";
  switch (e.kind) {
    case "guarded":
      return zh
        ? `${oth}扑进了${fav}${e.timed ? "及时的" : ""}防守：${oth}一个踉跄，被反弹了 ${e.back} 点。`
        : `${oth} pounced into ${fav}'s ${e.timed ? "well-timed " : ""}guard: ${oth} staggered and took ${e.back} back.`;
    case "dodged":
      return zh
        ? `${fav}干净利落地躲开了${oth}的扑击，反击 ${e.back} 点。`
        : `${fav} dodged ${oth}'s pounce cleanly and hit back for ${e.back}.`;
    case "caught":
      return zh ? `${oth}想躲开${fav}的扑击，却被扑个正着。` : `${oth} tried to dodge ${fav}'s pounce and was caught.`;
    case "punished":
      return zh
        ? `${fav}趁${oth}${OPEN[e.open].zh}时扑过去，多造成 ${SPAR_PUNISH} 点。`
        : `${fav} pounced while ${oth} was ${OPEN[e.open].en}: ${SPAR_PUNISH} extra damage.`;
    case "feint":
      return zh
        ? `${fav}的卖萌绕过了${oth}的防守，造成 ${e.hit} 点。`
        : `${fav}'s charm slipped past ${oth}'s guard for ${e.hit}.`;
  }
}

/** F11 for spars, both sides (G2): scrub the rounds and see which rule of each brain picked each move, and what came of it. */
export function FightRewind({
  pet,
  result,
  other,
}: {
  pet: Pet;
  result: SparResult;
  other: ReturnType<typeof otherSide>;
}) {
  const lang = useLang((s) => s.lang) as Lang;
  const why = useMemo(
    () =>
      rewindFight(
        {
          ...(pet.family
            ? { halves: halvesOf(pet.family, pet.lessons, skillRules(pet.growth)) }
            : { program: programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth) }),
          ...(pet.outside ? { outside: pet.outside } : {}),
        },
        pet.brain,
        result.rounds.map((r) => r.words[0]),
      ),
    [pet, result],
  );
  const otherWhy = useMemo(
    () =>
      other.mind
        ? rewindFight(
            other.mind,
            other.memory ?? [],
            result.rounds.map((r) => r.words[1]),
          )
        : null,
    [other, result],
  );
  const [k, setK] = useState(0);
  // the round shown: the one picked, or the last there is
  const at = Math.min(k, why.length - 1);
  const w = why[at];
  const round = result.rounds[at];
  if (!w || !round) return null;
  const chips = w.outside
    ? lang === "zh"
      ? { when: ["它学会的本能电路想出招"], then: MOVE_LABEL.zh[w.want] ?? "", want: w.want }
      : { when: ["its taught instinct circuit wanted a move"], then: MOVE_LABEL.en[w.want] ?? "", want: w.want }
    : decidingChips(w.program, w.rule, lang, true);
  const chosen = MOVES[w.want];
  if (!chosen) return null;
  const changed = round.moves[0] !== chosen;
  const ow = otherWhy?.[at];
  const otherChips = ow
    ? ow.outside
      ? {
          when: [lang === "zh" ? "它学会的本能电路想出招" : "its taught instinct circuit wanted a move"],
          then: MOVE_LABEL[lang][ow.want] ?? "",
          want: ow.want,
        }
      : decidingChips(ow.program, ow.rule, lang, true)
    : null;
  const exchanges = exchangesOf(result.version, result.rounds, at);
  const names: [string, string] = [pet.name, other.name[lang]];
  return (
    <div className="sp-why">
      <p className="label">
        {lang === "zh" ? `回看：${pet.name}每一招为什么这么出` : `Rewind: why ${pet.name} made each move`}
      </p>
      <div className="sp-why-rounds" role="radiogroup" aria-label={lang === "zh" ? "回合" : "Rounds"}>
        {why.map((wi, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={i === k}
            aria-label={`${lang === "zh" ? "第" : "Round "}${i + 1}${lang === "zh" ? "回合" : ""}`}
            style={{ background: WANT_COLORS[wi.want] }}
            onClick={() => (play("tap"), setK(i))}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="rw-card">
        <p className="rw-say" style={{ borderColor: WANT_COLORS[w.want] }}>
          {lang === "zh"
            ? `第 ${k + 1} 回合：${MOVE_LABEL.zh[MOVES.indexOf(round.moves[0])]}`
            : `Round ${k + 1}: ${MOVE_LABEL.en[MOVES.indexOf(round.moves[0])]}`}
          {changed && <span>{changedNote(w.want, round.moves[0], lang)}</span>}
        </p>
        <div className="rw-rule">
          <Chips when={chips.when} then={chips.then} want={chips.want} />
          <small>{RULE_SOURCE[ruleSource(w)][lang]}</small>
        </div>
        <div className="rw-rule rw-other">
          <p className="small">
            <b>{other.name[lang]}</b>
            {lang === "zh"
              ? `：${MOVE_LABEL.zh[MOVES.indexOf(round.moves[1])]}`
              : `: ${MOVE_LABEL.en[MOVES.indexOf(round.moves[1])]}`}
          </p>
          {ow && round.moves[1] !== MOVES[ow.want] && <small>{changedNote(ow.want, round.moves[1], lang)}</small>}
          {otherChips ? (
            <Chips when={otherChips.when} then={otherChips.then} want={otherChips.want} />
          ) : (
            <small>
              {lang === "zh"
                ? "它自己的电路这样出招，看不到规则。"
                : "Its own circuit chose this; it has no rules to show."}
            </small>
          )}
        </div>
        {exchanges.length > 0 && (
          <ul className="rw-ex">
            {exchanges.map((e, i) => (
              <li key={i}>{exchangeLine(e, names, lang)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The end of a replayed fight (from a result link): who won, and the fingerprint anyone can check. */
export function ReplayResult({
  self,
  partner,
  result,
  onDone,
}: {
  self: { name: string };
  partner: Partner;
  result: SparResult;
  onDone: () => void;
}) {
  const lang = useLang((s) => s.lang) as Lang;
  const title =
    result.winner === 0
      ? lang === "zh"
        ? `${self.name}赢了`
        : `${self.name} won`
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
      <p className="small">
        {lang === "zh"
          ? "这场切磋是在你的浏览器里，用链接里两只宠物的大脑重新算出来的。指纹一样，就是同一场。"
          : "This spar was just recomputed in your browser from both pets' brains in the link. The same fingerprint means the same fight."}
      </p>
      <p className="small sp-fp">
        {lang === "zh"
          ? `回放指纹 ${result.digest} · 种子 ${result.seed}`
          : `Replay ${result.digest} · seed ${result.seed}`}
      </p>
      <div className="row">
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "关闭" : "Close"}
        </button>
      </div>
    </motion.div>
  );
}
