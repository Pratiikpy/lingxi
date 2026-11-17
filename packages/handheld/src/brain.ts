/**
 * The circuit a pet takes on the handheld (plan 4.14), built from the pet as the game holds it, and the check that
 * it thinks exactly as the game's own brain does before the pet may leave.
 *
 * A child's mind is composed by REF of its two halves and an owned instinct by REF of the pet's own circuit and the
 * instinct's, the same circuits a tape-out puts on X Layer. Circuits that exist only here are filed under LOCAL, an
 * address no processor has, so a packet can never name a local circuit as though it were on chain.
 */

import { type Circuit, type PetNetlist, STARTERS, circuitBrain, compileProgram, composeChild, composeInstinct, hexToBytes, load, netlistBytes, refKey } from "@lingxi/brain";
import { type Brain, type Pet, composeProgram, halvesOf, mindExtra, skillRules } from "@lingxi/game";
import type { BrainPart, TripBrain } from "./trip";

export const LOCAL = "0x000000000000000000000000000000000000000b";

const IDS = { half: [1n, 2n], own: 3n, withInstinct: 4n } as const;

/** The program a pet without a family runs, exactly as the game's brain builder picks it. */
function ownProgram(pet: Pet) {
  const lessons = pet.lessons ?? [];
  const instincts = pet.instincts ?? 0;
  // a pet with an owned instinct is built by the game's mind builder; one without, by its brain cache
  if (pet.outside) return composeProgram(pet.line, lessons, instincts, mindExtra(pet.growth));
  const rules = skillRules(pet.growth);
  return lessons.length || instincts || rules.length ? composeProgram(pet.line, lessons, instincts, { rules }) : STARTERS[pet.line];
}

const local = (id: bigint, n: PetNetlist): BrainPart => ({ processor: LOCAL, id, nIn: n.nIn, nOut: n.nOut, bytes: netlistBytes(n) });

/** The circuit the game runs for this pet, composed by REF as it would be taped out. */
export function gameCircuit(pet: Pet): TripBrain {
  let own: TripBrain;
  if (pet.family) {
    const [pa, pb] = halvesOf(pet.family, pet.lessons ?? [], skillRules(pet.growth));
    own = {
      processor: LOCAL,
      id: IDS.own,
      bytes: composeChild({ cpu: LOCAL, id: IDS.half[0] }, { cpu: LOCAL, id: IDS.half[1] }).bytes,
      parts: [local(IDS.half[0], compileProgram(pa)), local(IDS.half[1], compileProgram(pb))],
    };
  } else {
    own = { processor: LOCAL, id: IDS.own, bytes: netlistBytes(compileProgram(ownProgram(pet))), parts: [] };
  }
  if (!pet.outside) return own;
  const instinct = pet.outside.parts.map((q) => ({ processor: q.processor, id: BigInt(q.id), nIn: q.nIn, nOut: q.nOut, bytes: hexToBytes(q.hex) }));
  return {
    processor: LOCAL,
    id: IDS.withInstinct,
    bytes: composeInstinct({ cpu: LOCAL, id: IDS.own }, { cpu: pet.outside.processor, id: BigInt(pet.outside.id) }).bytes,
    parts: [...own.parts, { processor: LOCAL, id: IDS.own, nIn: 16, nOut: 8, bytes: own.bytes }, ...instinct],
  };
}

/** The travelling circuit loaded as the game will run it, every REF resolved from the circuits handed over with it. */
export function tripBrainOf(t: TripBrain): { brain: Brain; circuit: Circuit } {
  const built = new Map<string, Circuit>();
  const resolve = (cpu: string, id: bigint): Circuit | null => {
    const k = refKey(cpu, id);
    const hit = built.get(k);
    if (hit) return hit;
    const p = t.parts.find((x) => refKey(x.processor, x.id) === k);
    if (!p) return null;
    const c = load(p.bytes, p.nIn, p.nOut, resolve);
    built.set(k, c);
    return c;
  };
  const circuit = load(t.bytes, 16, 8, resolve);
  return { brain: { fast: circuitBrain(circuit), nState: circuit.nState }, circuit };
}

/**
 * Every input word, from the pet's memory now and from an empty memory: the travelling circuit must answer and
 * remember exactly as the pet's own brain does. Yields every few thousand words so a page stays responsive.
 */
export async function sameMind(own: Brain, trip: Brain, memory: readonly number[]): Promise<boolean> {
  if (own.nState !== trip.nState) return false;
  for (const start of [memory, new Array<number>(own.nState).fill(0)]) {
    for (let w = 0; w < 1 << 16; w++) {
      const a = Uint8Array.from(start);
      const b = Uint8Array.from(start);
      if (own.fast.step(a, w) !== trip.fast.step(b, w)) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      if ((w & 4095) === 4095) await new Promise((r) => setTimeout(r, 0));
    }
  }
  return true;
}
