/**
 * Verify a battle against X Layer (PRD A4): read the pet's brain circuit back
 * from the chain, re-run the whole fight with that circuit in place of the one
 * this device compiled, and compare fingerprints. Then ask the chain itself
 * (a free eth_call of PetRegistry.replayStep) what the pet's circuit answers to
 * every round's senses, and check each answer against the move it made.
 */

import { bitsToWord, circuitBrain } from "@lingxi/brain";
import { loadCircuitFromChain, readPet, replayStep } from "@lingxi/chain";
import {
  type Fighter,
  MAX_STAMINA,
  type Move,
  TEAM_SPAR,
  type SparResult,
  type SparVersion,
  type TeamResult,
  type TeamUnit,
  allowedMove,
  fight,
  rulesOf,
  teamSpar,
} from "@lingxi/game";
import { deployment, publicClient } from "./chain";

export interface BattleCheck {
  petId: string;
  brainId: string;
  /** fingerprint of the fight re-run with the brain read from the chain */
  digest: string;
  same: boolean;
  /** rounds whose move the chain's own replayStep confirms */
  confirmed: number;
  rounds: number;
  /** first round (1-based) where the chain's answer differs, if any */
  differs?: number;
}

export async function checkSparOnChain(opts: {
  petId: string;
  /** the pet as it fought: its memory at the start and its level */
  me: Fighter;
  /** a fresh copy of the opponent */
  them: () => Fighter;
  result: SparResult;
  cheer: boolean;
  onProgress?: (done: number) => void;
}): Promise<BattleCheck> {
  if (!deployment) throw new Error("no deployment");
  const id = BigInt(opts.petId);
  const p = await readPet(publicClient, deployment, id);
  const circuit = await loadCircuitFromChain(publicClient, p.processor, p.brainId);
  if (circuit.nState !== opts.me.memory.length) {
    return {
      petId: opts.petId,
      brainId: p.brainId.toString(),
      digest: "",
      same: false,
      confirmed: 0,
      rounds: opts.result.rounds.length,
      differs: 1,
    };
  }
  const chainMe: Fighter = { ...opts.me, brain: circuitBrain(circuit), memory: opts.me.memory.slice() };
  // each spar is re-fought in the version it was fought in (an LX-SPAR/1 spar from before G2 still checks)
  const rerun = fight(opts.result.version, chainMe, opts.them(), opts.result.seed, () => [opts.cheer, false]);
  // full stamina as the spar's own version counts it (from LX-SPAR/2 a share of the skills' stamina)
  const rules = rulesOf(opts.result.version);
  const full = MAX_STAMINA + Math.floor((opts.me.mods?.stamina ?? 0) * (rules ? rules.skillStaminaShare : 1));
  const steps = opts.result.rounds.map((r, i) => ({
    word: r.words[0],
    stamina: i === 0 ? full : opts.result.rounds[i - 1]!.stamina[0],
    made: r.moves[0],
  }));
  const { confirmed, differs } = await askChain(id, opts.me.memory, steps, opts.result.version, opts.onProgress);
  return {
    petId: opts.petId,
    brainId: p.brainId.toString(),
    digest: rerun.digest,
    same: rerun.digest === opts.result.digest,
    confirmed,
    rounds: opts.result.rounds.length,
    ...(differs ? { differs } : {}),
  };
}

interface Step {
  word: number;
  /** stamina before the move */
  stamina: number;
  made: Move;
}

/** Round by round, the chain answers what the pet's circuit wants on the senses it had. */
async function askChain(
  id: bigint,
  memory: readonly number[],
  steps: Step[],
  version: SparVersion,
  onProgress?: (done: number) => void,
): Promise<{ confirmed: number; differs?: number }> {
  let state = bitsToWord(memory);
  let confirmed = 0;
  let differs: number | undefined;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const step = await replayStep(publicClient, deployment!, id, state, s.word);
    state = step.next;
    // the game's own rules on top of the brain, as the spar's version has them; a pounce can also slip into a tap
    const allowed = allowedMove(version, step.outputs, s.stamina);
    if (s.made === allowed || (allowed === "pounce" && s.made === "tap")) confirmed++;
    else if (differs === undefined) differs = i + 1;
    onProgress?.(i + 1);
  }
  return { confirmed, ...(differs ? { differs } : {}) };
}

/** The same check for an arena team battle: the pet leads side 0. */
export async function checkTeamOnChain(opts: {
  petId: string;
  mine: () => TeamUnit[];
  theirs: () => TeamUnit[];
  result: TeamResult;
  onProgress?: (done: number) => void;
}): Promise<BattleCheck> {
  if (!deployment) throw new Error("no deployment");
  const id = BigInt(opts.petId);
  const p = await readPet(publicClient, deployment, id);
  const circuit = await loadCircuitFromChain(publicClient, p.processor, p.brainId);
  const mine = opts.mine();
  const pet = mine[0]!;
  const fought = opts.result.rounds.filter((r) => r.words[0][0]! >= 0);
  if (circuit.nState !== pet.memory.length)
    return {
      petId: opts.petId,
      brainId: p.brainId.toString(),
      digest: "",
      same: false,
      confirmed: 0,
      rounds: fought.length,
      differs: 1,
    };
  // each team battle is re-fought in the version it was fought in (LX-TEAM/1 battles from before B3c still check)
  const rerun = teamSpar(
    [{ ...pet, brain: circuitBrain(circuit) }, ...mine.slice(1)],
    opts.theirs(),
    opts.result.seed,
    opts.result.version,
  );
  const steps = fought.map((r) => ({ word: r.words[0][0]!, stamina: r.stamina[0][0]!, made: r.moves[0][0]! }));
  // a team battle's moves follow its version's spar rules (LX-TEAM/1 those of LX-SPAR/1, LX-TEAM/2 those of LX-SPAR/3)
  const { confirmed, differs } = await askChain(id, pet.memory, steps, TEAM_SPAR[opts.result.version], opts.onProgress);
  return {
    petId: opts.petId,
    brainId: p.brainId.toString(),
    digest: rerun.digest,
    same: rerun.digest === opts.result.digest,
    confirmed,
    rounds: steps.length,
    ...(differs ? { differs } : {}),
  };
}
