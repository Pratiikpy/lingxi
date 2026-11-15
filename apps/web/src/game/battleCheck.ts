/**
 * Verify a battle against X Layer (PRD A4): read the pet's brain circuit back
 * from the chain, re-run the whole fight with that circuit in place of the one
 * this device compiled, and compare fingerprints. Then ask the chain itself
 * (a free eth_call of PetRegistry.replayStep) what the pet's circuit answers to
 * every round's senses, and check each answer against the move it made.
 */

import { bitsToWord, circuitBrain } from "@lingxi/brain";
import { loadCircuitFromChain, readPet, replayStep } from "@lingxi/chain";
import { type Fighter, MAX_STAMINA, MOVES, type Move, type SparResult, type TeamResult, type TeamUnit, spar, teamSpar } from "@lingxi/game";
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
    return { petId: opts.petId, brainId: p.brainId.toString(), digest: "", same: false, confirmed: 0, rounds: opts.result.rounds.length, differs: 1 };
  }
  const chainMe: Fighter = { ...opts.me, brain: circuitBrain(circuit), memory: opts.me.memory.slice() };
  const rerun = spar(chainMe, opts.them(), opts.result.seed, () => [opts.cheer, false]);
  const steps = opts.result.rounds.map((r, i) => ({ word: r.words[0], stamina: i === 0 ? MAX_STAMINA : opts.result.rounds[i - 1]!.stamina[0], made: r.moves[0] }));
  const { confirmed, differs } = await askChain(id, opts.me.memory, steps, opts.onProgress);
  return { petId: opts.petId, brainId: p.brainId.toString(), digest: rerun.digest, same: rerun.digest === opts.result.digest, confirmed, rounds: opts.result.rounds.length, ...(differs ? { differs } : {}) };
}

interface Step {
  word: number;
  /** stamina before the move */
  stamina: number;
  made: Move;
}

/** Round by round, the chain answers what the pet's circuit wants on the senses it had. */
async function askChain(id: bigint, memory: readonly number[], steps: Step[], onProgress?: (done: number) => void): Promise<{ confirmed: number; differs?: number }> {
  let state = bitsToWord(memory);
  let confirmed = 0;
  let differs: number | undefined;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const step = await replayStep(publicClient, deployment!, id, state, s.word);
    state = step.next;
    const want = MOVES[step.outputs & 7]!;
    // the game's own rules on top of the brain: a pet with no stamina left can only rest or tap, and a pounce can slip into a tap
    const allowed = s.stamina <= 0 && want !== "rest" && want !== "tap" ? "rest" : want;
    if (s.made === allowed || (allowed === "pounce" && s.made === "tap")) confirmed++;
    else if (differs === undefined) differs = i + 1;
    onProgress?.(i + 1);
  }
  return { confirmed, ...(differs ? { differs } : {}) };
}

/** The same check for an arena team battle: the pet leads side 0. */
export async function checkTeamOnChain(opts: { petId: string; mine: () => TeamUnit[]; theirs: () => TeamUnit[]; result: TeamResult; onProgress?: (done: number) => void }): Promise<BattleCheck> {
  if (!deployment) throw new Error("no deployment");
  const id = BigInt(opts.petId);
  const p = await readPet(publicClient, deployment, id);
  const circuit = await loadCircuitFromChain(publicClient, p.processor, p.brainId);
  const mine = opts.mine();
  const pet = mine[0]!;
  const fought = opts.result.rounds.filter((r) => r.words[0][0]! >= 0);
  if (circuit.nState !== pet.memory.length) return { petId: opts.petId, brainId: p.brainId.toString(), digest: "", same: false, confirmed: 0, rounds: fought.length, differs: 1 };
  const rerun = teamSpar([{ ...pet, brain: circuitBrain(circuit) }, ...mine.slice(1)], opts.theirs(), opts.result.seed);
  const steps = fought.map((r) => ({ word: r.words[0][0]!, stamina: r.stamina[0][0]!, made: r.moves[0][0]! }));
  const { confirmed, differs } = await askChain(id, pet.memory, steps, opts.onProgress);
  return { petId: opts.petId, brainId: p.brainId.toString(), digest: rerun.digest, same: rerun.digest === opts.result.digest, confirmed, rounds: steps.length, ...(differs ? { differs } : {}) };
}
