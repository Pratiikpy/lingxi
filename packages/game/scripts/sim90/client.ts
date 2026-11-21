/**
 * What the simulator needs from the web client, which the shared packages do not hold.
 *
 * What a spar win pays and how long a round is shown come from the game package, which the arena imports too, and so
 * do the tally rules (tallyRules.ts, G11): the simulator counts exactly what the client counts. Only a pet's spar level
 * by stage is asked here, through its shared twin.
 */

import type { ConditionView, WorldState } from "@lingxi/world";
import { type Pet, friendPartner, petCard, questView } from "../../src";

/** What a spar won pays and how long a round is shown: the game's own numbers, shared with the arena (spar.ts). */
export { SPAR_WIN_COINS as WIN_COINS, SPAR_FIRST_WIN_COINS as FIRST_WIN_COINS, SPAR_ROUND_MS as ROUND_MS, SPAR_FIRST_ROUND_MS as FIRST_ROUND_MS } from "../../src";

/**
 * A pet's level in a spar by its stage. The client's Arena.tsx `levelOf` has a shared twin: the level a friend's
 * card fights at (partners.ts friendPartner), which this asks.
 */
const levels = new Map<string, number>();
export function sparLevel(stage: string): number {
  let level = levels.get(stage);
  if (level === undefined) {
    const p = friendPartner({ id: "sim", name: "sim", line: "gentle", stage, lessons: petCard({ lessons: [] }) });
    if (!p) throw new Error("friendPartner refused an empty card");
    levels.set(stage, (level = p.level));
  }
  return level;
}

/**
 * What a care, a food, a watched minute, the pet's choices while away, a talk and a look at a builder's pet count
 * toward, where each giver is found, and the view a quest condition reads: the client's own rules (G11), shared.
 */
export { GIVER_ROOM, type TallyEntry, awayTally, careTally, fedTally, meetTally, minuteTally, talkTally } from "../../src";

/** The quest view for one pet raised alone, off chain, with no friends' pets (the client's conditionViewFrom). */
export const viewOf = (w: WorldState, p: Pet, now: number): ConditionView => questView({ world: w, pet: p, pets: 1, onChain: false, bondLevel: 0, goalsDone: [], now, tzOffsetMin: p.tzOffsetMin });
