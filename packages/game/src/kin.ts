/**
 * Family visits (PRD G3, after Tamagotchi Uni's "Paradise"): a pet's relatives
 * who live on the same device drop by its home now and then. Who is related is
 * read from the family records (a child keeps its parents' keys); who visits
 * when is fixed by the hour and the pets, so it is the same on every reload.
 */

import type { Pet } from "./sim";

export type Kin = "parent" | "child" | "sibling";

const key = (p: Pick<Pet, "bornAt">) => String(p.bornAt);

/** Every relative of `pet` among `pets`, with how they are related. */
export function relatives(pet: Pet, pets: readonly Pet[]): Array<{ pet: Pet; kin: Kin }> {
  const mine = new Set((pet.family?.parents ?? []).map((p) => p.key).filter(Boolean));
  const out: Array<{ pet: Pet; kin: Kin }> = [];
  for (const other of pets) {
    if (other.bornAt === pet.bornAt) continue;
    const theirs = (other.family?.parents ?? []).map((p) => p.key).filter(Boolean);
    if (mine.has(key(other))) out.push({ pet: other, kin: "parent" });
    else if (theirs.includes(key(pet))) out.push({ pet: other, kin: "child" });
    else if (theirs.some((k) => mine.has(k))) out.push({ pet: other, kin: "sibling" });
  }
  return out;
}

function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x27d4eb2f, 0x165667b1) ^ Math.imul(b ^ 0x9e3779b9, 0x85ebca77);
  h ^= h >>> 13;
  return Math.imul(h, 0xc2b2ae3d) >>> 0;
}

/** Relatives visiting this hour: each drops by about one hour in three, at most two at once. */
export function visitorsNow(pet: Pet, pets: readonly Pet[], hour: number): Array<{ pet: Pet; kin: Kin }> {
  return relatives(pet, pets)
    .filter((r) => mix(hour, Math.floor(r.pet.bornAt / 1000)) % 3 === 0)
    .slice(0, 2);
}
