/**
 * A26: one card budget for every road a card travels. The fullest pet a player can raise, with an instinct at the
 * largest size the game lets it learn, fits every limit: the card, the duel link's code, and the child relay's card
 * (which carries no instinct).
 */
import { describe, expect, it } from "vitest";
import { CARD_BASE_MAX, CARD_MAX, CARD_OUTSIDE_MAX, MAX_DUEL_CODE, MAX_LESSONS, SKILLS, encodeChallenge, instinctFits, parseCard, petCard } from "../src/index";

const wide = { when: { event: [1, 2, 3], hunger: [0, 1, 2], mood: [0, 1, 2, 3], trust: [0, 1, 2] }, then: { want: 5, mood: 3 } };
const parent = { name: "Mochimochimo", line: "gentle", lessons: Array(MAX_LESSONS).fill(wide), instincts: 255 };
const fullest = { lessons: Array(MAX_LESSONS).fill(wide), growth: { level: 60, points: 0, skills: Object.fromEntries(SKILLS.map((s) => [s.id, 5])) }, family: { parents: [parent, parent], generation: 1 }, brain: Array(64).fill(1), instincts: 255 };
const parts = (hex: number) => [{ processor: `0x${"a".repeat(40)}`, id: "123456", nIn: 16, nOut: 8, hex: "0".repeat(hex) }];
const outside = (hex: number) => ({ processor: `0x${"a".repeat(40)}`, id: "123456", owner: `0x${"b".repeat(40)}`, parts: parts(hex) });
const duelCode = (card: string) => encodeChallenge({ id: "x".repeat(16), from: { name: "Mochimochimo", line: "gentle", stage: "adult", card, story: { days: 9999, lessons: 8, nature: ["playful", "curious", "gentle"] } }, at: 1_800_000_000_000 } as never);

describe("a pet's card fits every road it travels (A26)", () => {
  it("the fullest pet's own part stays under the base budget, so the child relay can carry it", () => {
    expect(petCard(fullest as never).length).toBeLessThanOrEqual(CARD_BASE_MAX);
  });

  it("with the largest instinct the game lets it learn, the whole card fits the budget and the duel link", () => {
    const card = petCard({ ...fullest, outside: outside(CARD_OUTSIDE_MAX) } as never);
    expect(card.length).toBeLessThanOrEqual(CARD_MAX);
    expect(duelCode(card).length).toBeLessThanOrEqual(MAX_DUEL_CODE);
  });

  it("an instinct fits only while its circuits fit the card", () => {
    expect(instinctFits(parts(CARD_OUTSIDE_MAX))).toBe(true);
    expect(instinctFits(parts(CARD_OUTSIDE_MAX + 2))).toBe(false);
    expect(instinctFits([...parts(CARD_OUTSIDE_MAX / 2), ...parts(CARD_OUTSIDE_MAX / 2 + 2)])).toBe(false);
  });

  it("a card over the budget is not read at all", () => {
    expect(parseCard("x".repeat(CARD_MAX + 1))).toBeNull();
  });
});
