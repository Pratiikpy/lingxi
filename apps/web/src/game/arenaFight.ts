/**
 * The fight on the spar screen and what starts one: kept apart from the screen (play/Arena.tsx) so whatever starts a
 * fight at start-up (a duel link, a friend's card, Behemoth's card) does not load the whole spar screen with the game (P3).
 */
import { create } from "zustand";
import { STARTERS } from "@lingxi/brain";
import {
  BEHEMOTH_LEVEL,
  CURRENT_SPAR,
  type Challenge,
  type DuelPet,
  type Fighter,
  type Partner,
  type Pet,
  type SparResult,
  type SparVersion,
  TRAITS,
  behemothFighter,
  dailySparVersion,
  dayOf,
  duel as runDuel,
  duelFighter,
  fight as fightSpar,
  fighterOfMind,
  fighterOfPartner,
  petCard,
  rulesOf,
  stageOf,
} from "@lingxi/game";
import { fighterOf, useAdopted } from "./adopt";
import { now } from "./gameClock";
import { play } from "./sound";
import { useWorld } from "./world";
import type { PetStage } from "../scene/palette";

export const levelOf = (stage: string) => (stage === "elder" ? 2 : stage === "teen" || stage === "adult" ? 1 : 0);
export const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));

const BEHEMOTH_PARTNER: Partner = { id: "builder:behemoth", name: { en: "Behemoth", zh: "巨兽" }, look: "behemoth", line: "gentle", stage: "adult", level: BEHEMOTH_LEVEL, blurb: { en: "", zh: "" }, program: STARTERS.gentle };

export type FightState = {
  partner: Partner;
  result: SparResult;
  cheer: boolean;
  opponent?: Fighter;
  duel?: { challenge: Challenge; reply: DuelPet; version: SparVersion };
  daily?: boolean;
  /** the adopted brain the pet fought with, if not its own */
  instinct?: string;
  /** item bonuses spent on this spar (plan 4.5): coins paid even if it is lost */
  boostCoins?: number;
  boosted?: boolean;
};

/** A fight on the spar screen; `again`: the same fight shown once more as a replay, nothing paid or recorded twice. */
export type ArenaFight = FightState & { again?: boolean };

/**
 * The fight on the spar screen. It is kept outside the panel so whatever starts a fight (a partner picked on the
 * screen, a friend's card arriving, a duel link accepted, Behemoth's card) starts it in that same event, and the
 * screen opens onto it; closing the screen ends it, as the screen's own state would.
 */
export const useArena = create<{ fight: ArenaFight | null }>(() => ({ fight: null }));

/** Behemoth, as a sparring partner; its moves come from its own CPU (`behemothFighter`). */
export const BEHEMOTH = { partner: BEHEMOTH_PARTNER, opponent: () => behemothFighter(BEHEMOTH_PARTNER.name.en) };

/**
 * Starts a fight for `pet` against `partner`, with the pet as it is at this moment: spends the bonuses readied from
 * the bag on a practice spar (never on the shared daily challenge), rolls a practice spar's seed, and shows the fight.
 */
export function startFight(pet: Pet, partner: Partner, o: { daily?: { seed: number; day: number }; opponent?: Fighter; cheer?: boolean } = {}): void {
  const { daily, opponent } = o;
  const stage = stageOf(pet, now());
  const own = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts, outside: pet.outside, growth: pet.growth }, levelOf(stage), pet.brain);
  // the daily challenge is the same fight for everyone, so it is always fought with the pet's own mind
  const adopted = useAdopted.getState().byPet[String(pet.bornAt)];
  const me = !daily && adopted?.on ? fighterOf(adopted, pet.name, levelOf(stage)) : own;
  // the daily challenge switches version on a set day; a partner fights with its brain for that version (B3b)
  const version = daily ? dailySparVersion(daily.day) : CURRENT_SPAR;
  const them = opponent ?? fighterOfPartner(partner, version);
  // practice spars roll a private seed; the daily challenge uses the day's block, with no cheering, so it is the same for everyone
  const seed = daily ? daily.seed : crypto.getRandomValues(new Uint32Array(1))[0]!;
  const cheering = daily ? false : (o.cheer ?? false);
  // bonuses readied from the bag (a Wild Jewel, a tonic) are spent on the next practice spar; never on the shared daily
  const boost = daily ? { power: 0, hp: 0, lossCoins: 0 } : useWorld.getState().spendSparBuffs();
  const boosted = boost.power > 0 || boost.hp > 0;
  // D14: from LX-SPAR/4 a bag bonus is applied at face value ("+15 health" is 15 health); earlier versions folded it into
  // the skills, where it all but vanished
  const fighter: Fighter = !boosted
    ? me
    : rulesOf(version)?.boostAtFaceValue
      ? { ...me, boost: { hp: boost.hp, power: boost.power } }
      : { ...me, mods: { stamina: 0, guard: 0, dodge: 0, heal: 0, ...me.mods, power: (me.mods?.power ?? 0) + boost.power, hp: (me.mods?.hp ?? 0) + boost.hp } };
  play("tap");
  useArena.setState({
    fight: {
      partner,
      // the daily challenge switches version on a set day, so one day is one fight for everyone; practice uses today's
      result: fightSpar(version, fighter, them, seed, () => [cheering, false]),
      cheer: cheering,
      ...(opponent ? { opponent } : {}),
      ...(daily ? { daily: true } : {}),
      ...(me !== own && adopted ? { instinct: adopted.name } : {}),
      ...(boost.lossCoins ? { boostCoins: boost.lossCoins } : {}),
      ...(boosted || boost.lossCoins ? { boosted: true } : {}),
    },
  });
}

/** Answers a challenge from a link: our pet, as it is now, replies with its own brain on the challenge's fixed seed. */
export function startDuel(pet: Pet, d: Challenge): void {
  const reply = duelPetOf(pet);
  play("tap");
  const result = runDuel(d, reply);
  useArena.setState({ fight: { partner: partnerOfDuel(d), result, cheer: false, opponent: duelFighter(d.from), duel: { challenge: d, reply, version: result.version } } });
}

/** The pet as it travels in a challenge link: its whole mind, its body, and a few true facts. */
export function duelPetOf(pet: Pet): DuelPet {
  const stage = stageOf(pet, now());
  const nature = [...TRAITS].filter((t) => pet.traits[t] > 0).sort((a, b) => pet.traits[b] - pet.traits[a]).slice(0, 2);
  return {
    name: pet.name,
    line: pet.line,
    stage,
    card: petCard(pet),
    story: { days: dayOf(pet, now()), lessons: pet.lessons.length, nature },
  };
}

/** A challenger from a link, shaped as a sparring partner for the fight screen. */
export function partnerOfDuel(c: Challenge): Partner {
  const p = c.from;
  return {
    id: `friend:duel:${c.id}`,
    name: { en: p.name, zh: p.name },
    line: p.line,
    stage: drawn(p.stage),
    level: p.stage === "elder" ? 2 : p.stage === "teen" || p.stage === "adult" ? 1 : 0,
    blurb: { en: "", zh: "" },
    program: STARTERS[p.line],
  };
}
