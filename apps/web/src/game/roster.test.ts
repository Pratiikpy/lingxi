import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, stateBits } from "@lingxi/brain";
import { createPet, type Pet } from "@lingxi/game";
import { MAX_PETS, keptName, readRoster, rosterText } from "./roster";

const gentle = {
  fast: fastBrain(compileProgram(STARTERS.gentle)),
  nState: stateBits(STARTERS.gentle),
  program: STARTERS.gentle,
};
const pet = (name: string, bornAt: number): Pet => ({
  ...createPet({ name, line: "gentle", now: bornAt, tzOffsetMin: 480, brain: gentle }),
  bornAt,
});
/** A pet as a newer Lingxi might save it: a version this build has never seen, with fields it does not know. */
const fromTheFuture = { version: 2, name: "Nova", line: "gentle", bornAt: 7, wings: { span: 3 } };

describe("the roster's save (P1)", () => {
  it("keeps a pet from a newer version exactly as saved, names it, and writes it back with every save", () => {
    const raw = JSON.stringify({ active: 0, pets: [pet("Kiri", 1), fromTheFuture, pet("Mochi", 2)] });
    const { roster, kept } = readRoster(raw, null);
    expect(roster.pets.map((p) => p.name)).toEqual(["Kiri", "Mochi"]);
    expect(kept).toEqual([fromTheFuture]);
    expect(kept.map(keptName)).toEqual(["Nova"]);
    // an older page saving its roster carries the newer pet along, untouched
    const saved = JSON.parse(rosterText(roster, kept)) as { pets: Pet[]; kept: unknown[] };
    expect(saved.kept).toEqual([fromTheFuture]);
    expect(saved.pets).toHaveLength(2);
  });

  it("gives a kept pet back to the roster once a build can read it", () => {
    const later = pet("Nova", 7);
    const raw = JSON.stringify({ active: 0, pets: [pet("Kiri", 1)], kept: [later] });
    const { roster, kept } = readRoster(raw, null);
    expect(roster.pets.map((p) => p.name)).toEqual(["Kiri", "Nova"]);
    expect(kept).toEqual([]);
    expect(rosterText(roster, kept)).not.toContain('"kept"');
  });

  it("keeps a pet of a line this build does not know, and pets beyond the roster's size, instead of dropping them", () => {
    const strange = { ...pet("Ember", 3), line: "fiery" };
    const many = Array.from({ length: MAX_PETS + 2 }, (_, i) => pet(`P${i}`, 100 + i));
    const { roster, kept } = readRoster(JSON.stringify({ active: 9, pets: [...many, strange] }), null);
    expect(roster.pets).toHaveLength(MAX_PETS);
    expect(roster.active).toBe(MAX_PETS - 1);
    expect(kept.map(keptName)).toEqual(["Ember", `P${MAX_PETS}`, `P${MAX_PETS + 1}`]);
  });

  it("reads the single pet saved before families, and keeps it even when this build cannot read it", () => {
    expect(readRoster(null, JSON.stringify(pet("Solo", 5))).roster.pets.map((p) => p.name)).toEqual(["Solo"]);
    const r = readRoster(null, JSON.stringify(fromTheFuture));
    expect(r.roster.pets).toEqual([]);
    expect(r.kept).toEqual([fromTheFuture]);
  });

  it("refuses to guess at text that is not a save: it throws, and the save module holds it for the player", () => {
    expect(() => readRoster('{"active":0,"pets":[{"na', null)).toThrow();
  });

  it("names a kept pet safely whatever was saved", () => {
    expect(keptName({ name: "  A very long name that keeps going on  " })).toBe("A very long name that ke");
    expect(keptName({ name: 42 })).toBe("?");
    expect(keptName(null)).toBe("?");
  });
});
