import { describe, expect, it } from "vitest";
import { createPet } from "../src/sim";
import { familyOf, mindBrain } from "../src/family";
import { relatives, visitorsNow } from "../src/kin";

const brain = mindBrain({ line: "gentle", lessons: [] });
const pet = (name: string, at: number) => createPet({ name, line: "gentle", now: at, tzOffsetMin: 0, brain });
const mum = pet("Mum", 1_000_000);
const dad = { ...pet("Dad", 2_000_000), line: "bold" as const };
const fam = familyOf({ name: mum.name, line: mum.line, lessons: [], key: String(mum.bornAt) }, { name: dad.name, line: dad.line, lessons: [], key: String(dad.bornAt) });
const kid = { ...pet("Kid", 3_000_000), family: fam };
const kid2 = { ...pet("Kid2", 4_000_000), family: fam };
const stranger = pet("Stranger", 5_000_000);
const all = [mum, dad, kid, kid2, stranger];

describe("family visits", () => {
  it("knows parents, children and siblings, and nobody else", () => {
    expect(relatives(kid, all).map((r) => [r.pet.name, r.kin])).toEqual([["Mum", "parent"], ["Dad", "parent"], ["Kid2", "sibling"]]);
    expect(relatives(mum, all).map((r) => [r.pet.name, r.kin])).toEqual([["Kid", "child"], ["Kid2", "child"]]);
    expect(relatives(stranger, all)).toEqual([]);
  });

  it("visitors are fixed by the hour, about one hour in three each, never more than two", () => {
    expect(visitorsNow(kid, all, 500)).toEqual(visitorsNow(kid, all, 500));
    let seen = 0;
    for (let h = 0; h < 3000; h++) {
      const v = visitorsNow(kid, all, h);
      expect(v.length).toBeLessThanOrEqual(2);
      seen += v.filter((x) => x.pet.name === "Mum").length;
    }
    expect(seen / 3000).toBeGreaterThan(0.25);
    expect(seen / 3000).toBeLessThan(0.42);
  });
});
