/**
 * Look-alike pet names on chain (A16). PetLook lets a few characters that draw as nothing into a name, so "Mochi" plus
 * U+061C can be registered beside "Mochi". Given every pet's current name, this lists each name that carries such a
 * character, shown with U+FFFD in their place, with the pets whose names it would pass for (compared as PetLook
 * compares names: byte for byte after ASCII lower-casing). The owner's `releaseName` frees one.
 */
import { revealHidden, stripHidden } from "@lingxi/game";

export interface NamedPet {
  petId: bigint;
  name: string;
}

export interface Lookalike extends NamedPet {
  /** the name as the game shows it, each hidden character as U+FFFD */
  shown: string;
  hidden: number;
  /** the pets whose current names this one draws exactly like */
  imitates: bigint[];
}

const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function findLookalikes(pets: readonly NamedPet[]): Lookalike[] {
  const byName = new Map<string, bigint[]>();
  for (const p of pets) if (p.name) byName.set(fold(p.name), [...(byName.get(fold(p.name)) ?? []), p.petId]);
  return pets.flatMap((p) => {
    const { text, hidden } = revealHidden(p.name);
    if (!hidden) return [];
    const imitates = (byName.get(fold(stripHidden(p.name))) ?? []).filter((id) => id !== p.petId);
    return [{ ...p, shown: text, hidden, imitates }];
  });
}

/** A name with every character outside printable ASCII written as its code point, safe to print: "Mochi<U+061C>". */
export const escaped = (name: string): string =>
  Array.from(name, (ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0x20 && cp < 0x7f ? ch : `<U+${cp.toString(16).toUpperCase().padStart(4, "0")}>`;
  }).join("");
