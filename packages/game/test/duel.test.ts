import { describe, expect, it } from "vitest";
import { b64urlEncode } from "@lingxi/brain";
import { PET_SCHOOL } from "../src/lessons";
import { familyOf, petCard } from "../src/family";
import { DuelError, decodeChallenge, decodeResult, duel, duelSeed, encodeChallenge, encodeResult, type Challenge, type DuelPet } from "../src/duel";

const mochi: DuelPet = { name: "Mochi", line: "gentle", stage: "teen", card: petCard({ lessons: [PET_SCHOOL[1]!.rule], instincts: 1 }), story: { days: 6, lessons: 1, nature: ["brave"] } };
const rex: DuelPet = { name: "Rex", line: "bold", stage: "adult", card: petCard({ lessons: [], instincts: 2 }), story: { days: 12, lessons: 0, nature: [] } };
const challenge: Challenge = { id: "abcd1234ef", from: mochi, at: 1 };

describe("challenge links", () => {
  it("round-trip a challenge and a result", () => {
    const c = decodeChallenge(encodeChallenge(challenge));
    expect(c).toEqual(challenge);
    const r = decodeResult(encodeResult({ challenge, reply: rex }));
    expect(r.reply).toEqual(rex);
    expect(r.challenge.from.name).toBe("Mochi");
  });

  it("the fight is the same wherever it is replayed", () => {
    const a = duel(challenge, rex);
    const back = decodeResult(encodeResult({ challenge, reply: rex }));
    const b = duel(back.challenge, back.reply);
    expect(b.digest).toBe(a.digest);
    expect(b.rounds).toEqual(a.rounds);
    expect(duelSeed(challenge)).toBe(duelSeed({ id: "abcd1234ef" }));
    expect(duelSeed({ id: "abcd1234eg" })).not.toBe(duelSeed(challenge));
  });

  it("a child's two halves fight from a link too", () => {
    const fam = familyOf({ name: "A", line: "gentle", lessons: [] }, { name: "B", line: "curious", lessons: [], instincts: 4 });
    const bean: DuelPet = { name: "Bean", line: "gentle", stage: "child", card: petCard({ lessons: [], family: fam }), story: { days: 2, lessons: 0, nature: [] } };
    expect(duel({ ...challenge, from: bean }, rex).rounds.length).toBeGreaterThan(0);
  });

  it("refuses links that are damaged, oversized, impossible or hostile", () => {
    const bad = (v: unknown) => () => decodeChallenge("lxc1." + b64urlEncode(JSON.stringify(v)));
    expect(() => decodeChallenge("lxg1.xyz")).toThrow(DuelError);
    expect(() => decodeChallenge("lxc1.%%%")).toThrow(DuelError);
    expect(() => decodeChallenge("lxc1." + "A".repeat(13_000))).toThrow(DuelError);
    expect(bad({ ...challenge, id: "x" })).toThrow(DuelError);
    expect(bad({ ...challenge, from: { ...mochi, line: "dragon" } })).toThrow(DuelError);
    expect(bad({ ...challenge, from: { ...mochi, card: "{\"lessons\":[{\"when\":{\"nope\":[1]},\"then\":{\"want\":1,\"mood\":1}}]}" } })).toThrow();
    // names are cleaned of markup and control characters, and cut to 12
    const c = decodeChallenge(encodeChallenge({ ...challenge, from: { ...mochi, name: "<b>Evil</b>\u0000Mochi-the-great" } }));
    expect(c.from.name).not.toMatch(/[<>\u0000]/);
    expect(c.from.name.length).toBeLessThanOrEqual(12);
  });
});
