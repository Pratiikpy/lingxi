import { describe, expect, it } from "vitest";
import { b64urlEncode } from "@lingxi/brain";
import { GiftError, decodeGift, encodeGift, newGiftId } from "../src/gift";

const brave = { when: { event: [3], owner: [1] }, then: { want: 6, mood: 1, nudge: 1 } };
const base = { id: "abcdefgh12", from: { name: "Mochi", line: "gentle" as const, stage: "teen" }, letter: "Happy birthday! 生日快乐", at: 1_700_000_000_000 };

describe("gifts", () => {
  it("round-trips a letter, an egg with lessons, and an item", () => {
    const g = { ...base, egg: { line: "gentle" as const, lessons: [brave] }, item: { id: 11301, n: 2 } };
    expect(decodeGift(encodeGift(g))).toEqual(g);
  });

  it("refuses broken, empty, oversized and impossible gifts", () => {
    expect(() => decodeGift("nope")).toThrow(GiftError);
    expect(() => decodeGift("lxg1.%%%")).toThrow(GiftError);
    expect(() => decodeGift(encodeGift({ ...base, letter: "" }))).toThrow(/empty/);
    expect(() => decodeGift("lxg1." + "a".repeat(9000))).toThrow(/too long/);
    expect(() => decodeGift(encodeGift({ ...base, egg: { line: "evil" as never, lessons: [] } }))).toThrow(/egg/);
    expect(() => decodeGift(encodeGift({ ...base, egg: { line: "bold", lessons: [{ when: { bogus: [1] }, then: { want: 9 } } as never] } }))).toThrow(/egg/);
    expect(() => decodeGift(encodeGift({ ...base, item: { id: 1, n: 99 } }))).toThrow(/item/);
    expect(() => decodeGift("lxg1." + b64urlEncode(JSON.stringify({ ...base, id: "../x" })))).toThrow(/id/);
  });

  it("cleans the letter and names before use", () => {
    const g = decodeGift(encodeGift({ ...base, letter: "hi\u0000there".padEnd(400, "!"), from: { ...base.from, name: "A very long pet name indeed" } }));
    expect(g.letter.length).toBe(200);
    expect(g.letter).not.toContain("\u0000");
    expect(g.from.name.length).toBeLessThanOrEqual(12);
  });

  it("makes distinct ids", () => {
    const ids = new Set(Array.from({ length: 200 }, newGiftId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8,32}$/);
  });
});
