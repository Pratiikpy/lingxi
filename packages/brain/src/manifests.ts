/**
 * Interface manifests (PRD F31): what each input and output bit of a circuit
 * means, as plain data, so another app can load a Lingxi pet's brain from the
 * chain and know how to drive it, and so Lingxi can load brains made for other
 * apps. The format follows the DUEL-12x3/1 profile TapeFly serves at
 * /api/v1/brawl: an id, the inputs in bit order, and the outputs.
 */

import { INPUT_FIELDS, MOODS, NUDGES, N_IN, N_OUT, PIN_VERSION, WANTS } from "./pins";
import { DUEL_MOVES, DUEL_PROFILE } from "./tapefly";

export interface ManifestField {
  name: string;
  /** first input bit (bit 0 = pin 0, the order TapeOut's eval packs them) */
  lo: number;
  bits: number;
  values: readonly string[];
}

export interface Manifest {
  id: string;
  nIn: number;
  nOut: number;
  inputs: ManifestField[];
  outputs: ManifestField[];
  /** LATCH bits after the inputs and outputs, if the circuit keeps memory */
  memory: string;
  notes: string[];
}

export const PET_PROFILE = "PET-16x8/1";

/** A Lingxi pet brain: 16 senses in, a want, a mood and a trait nudge out. */
export const PET_MANIFEST: Manifest = {
  id: PET_PROFILE,
  nIn: N_IN,
  nOut: N_OUT,
  inputs: INPUT_FIELDS.map((f) => ({ name: f.name, lo: f.lo, bits: f.bits, values: f.values })),
  outputs: [
    { name: "want", lo: 0, bits: 3, values: WANTS },
    { name: "mood", lo: 3, bits: 2, values: MOODS },
    { name: "nudge", lo: 5, bits: 3, values: NUDGES },
  ],
  memory: "LATCH bits; each brain declares its own memory fields, in order, after the outputs",
  notes: [
    `Program language ${PIN_VERSION}: an ordered list of rules over these inputs; the first match decides, otherwise a default.`,
    "In a spar the same pins read the fight: hunger = own health (0 full), joy = momentum, energy = stamina, clean = the other pet's health (3 high), time = round phase (1 opening, 2 middle, 3 late), action = the other pet's last move (0 tap, 1 snack, 2 pounce, 3 guard, 4 rest, 5 charm, 6 dodge, 7 gift), event = 3 hit hard / 2 the other left an opening / 1 the other was friendly, owner = 1 while cheering.",
    "In a spar the want becomes a move: idle tap, eat snack, play pounce, sleep rest, explore dodge, sulk guard, cuddle charm, share gift. Each move costs stamina (tap 0, snack 1, pounce 3, rest 0 and gives back 3, dodge 2, guard 1, charm 2, gift 1), and a move the pet cannot pay for in full becomes a rest. Mood is how hard it plays: each step from calm hits 1 harder and takes 1 more from every hit (grumpy 1 softer and 1 less), except while it guards or dodges; a calm pet wins back 1 stamina on a tap. This is fight version LX-SPAR/3; every result names its version, and the same seed in the same version is the same fight.",
  ],
};

/** TapeFly's brawl brains, as Lingxi reads them. */
export const DUEL_MANIFEST: Manifest = {
  id: DUEL_PROFILE,
  nIn: 12,
  nOut: 3,
  inputs: [
    { name: "dist", lo: 0, bits: 2, values: ["far", "near", "close", "in reach"] },
    { name: "foe", lo: 2, bits: 2, values: ["moving", "shield facing me", "winding up a bite", "open"] },
    { name: "myhp", lo: 4, bits: 2, values: ["low", "lower", "higher", "full"] },
    { name: "foehp", lo: 6, bits: 2, values: ["low", "lower", "higher", "full"] },
    { name: "energy", lo: 8, bits: 2, values: ["none", "low", "fair", "full"] },
    { name: "prev", lo: 10, bits: 2, values: DUEL_MOVES },
  ],
  outputs: [
    { name: "move", lo: 0, bits: 2, values: DUEL_MOVES },
    { name: "bite", lo: 2, bits: 1, values: ["no", "start a bite"] },
  ],
  memory: "none",
  notes: [
    "Defined by TapeFly for its brawl; Lingxi follows it so a pet can spar a TapeFly brain.",
    "In a Lingxi spar: dist is always 3 (a spar is fought in reach); foe is 1 when the other guarded, 2 when it pounced, 3 when it rested or snacked; only a bite does damage: bite pounce, press rest, back and circle dodge, guard guard.",
  ],
};

export const MANIFESTS: readonly Manifest[] = [PET_MANIFEST, DUEL_MANIFEST];
