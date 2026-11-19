/**
 * A38: no card can carry a brain too big to run. An owned instinct whose parts REF each other many times expands to
 * millions of gates from a few kilobytes (k^4 work a beat for four levels of k REFs), and every road a card travels
 * (season standings, arena snapshots, duel results, room cards) ran it. An instinct may cost no more to run than the
 * largest one a card could carry with no REF at all.
 */
import { describe, expect, it } from "vitest";
import { NAND, REF, bytesToHex, encode, type Element } from "@lingxi/brain";
import { CARD_OUTSIDE_MAX, INSTINCT_MAX_GATES, MAX_RUN_GATES, MAX_GATES_SKILLED, cleanOutside, instinctGates, parseCard, petCard } from "../src";

const cpu = `0x${"ab".repeat(20)}`;
const hex = (els: Element[]) => bytesToHex(encode(els)).slice(2);

/** An instinct of `levels` parts below the top, each REFing the next `k` times, down to a one-gate leaf. */
function nested(k: number, levels = 3) {
  const refs = (nIn: number, to: bigint): Element[] => Array.from({ length: k }, (_, i) => ({ op: REF, ins: [2], cpu, id: to, nOut: 1, firstOut: 2 + nIn + i }) as Element);
  const parts = [{ processor: cpu, id: "1", nIn: 16, nOut: 8, hex: hex(refs(16, 2n)) }];
  for (let lvl = 2; lvl <= levels + 1; lvl++) parts.push({ processor: cpu, id: String(lvl), nIn: 1, nOut: 1, hex: hex(refs(1, BigInt(lvl + 1))) });
  parts.push({ processor: cpu, id: String(levels + 2), nIn: 1, nOut: 1, hex: hex([{ op: NAND, ins: [2, 2], nOut: 1, firstOut: 3 } as Element]) });
  return { processor: cpu, id: "1", owner: "", parts };
}

/** Eight REFs (the eight outputs) to one 1-in, 1-out circuit of `g` NANDs: it runs 8 * g gates a beat. */
function wide(g: number) {
  const top: Element[] = Array.from({ length: 8 }, (_, i) => ({ op: REF, ins: [2], cpu, id: 2n, nOut: 1, firstOut: 18 + i }) as Element);
  const chain: Element[] = Array.from({ length: g }, (_, i) => ({ op: NAND, ins: i === 0 ? [2, 2] : [2 + i, 2 + i], nOut: 1, firstOut: 3 + i }) as Element);
  return { processor: cpu, id: "1", owner: "", parts: [{ processor: cpu, id: "1", nIn: 16, nOut: 8, hex: hex(top) }, { processor: cpu, id: "2", nIn: 1, nOut: 1, hex: hex(chain) }] };
}

describe("a brain too big to run (A38)", () => {
  it("is as big as the largest instinct a card can carry with no REF, and the whole-mind budget holds every honest pet", () => {
    // a LATCH is the smallest element, 4 bytes: the card's instinct bytes hold at most this many gates flat
    expect(INSTINCT_MAX_GATES).toBe(CARD_OUTSIDE_MAX / 2 / 4);
    expect(MAX_RUN_GATES).toBeGreaterThanOrEqual(2 * MAX_GATES_SKILLED + INSTINCT_MAX_GATES);
  });

  it("counts an instinct's gates as it runs them: every REF counts its target again", () => {
    expect(instinctGates(nested(8, 2))).toBe(8 ** 3);
    expect(instinctGates(wide(10))).toBe(80);
  });

  it("refuses the reviewer's card (four levels of 55 REFs) before running it, and so refuses the whole card", () => {
    const o = nested(55);
    const t = performance.now();
    expect(cleanOutside(o)).toBeUndefined();
    expect(parseCard(JSON.stringify({ lessons: [], outside: o }))).toBeNull();
    expect(performance.now() - t, "refused for the cost of reading it").toBeLessThan(50);
  });

  it("refuses an instinct one gate past the budget, however it is built, and takes one at the budget", () => {
    expect(INSTINCT_MAX_GATES % 8).toBe(0);
    expect(cleanOutside(wide(INSTINCT_MAX_GATES / 8)), "exactly at the budget").toBeDefined();
    expect(cleanOutside(wide(INSTINCT_MAX_GATES / 8 + 1)), "8 gates past it").toBeUndefined();
    // 14^3 = 2,744 fits; 15^3 = 3,375 does not, from a card of a few hundred bytes
    expect(cleanOutside(nested(14, 2))).toBeDefined();
    expect(cleanOutside(nested(15, 2))).toBeUndefined();
    expect(parseCard(petCard({ lessons: [], outside: nested(14, 2) }))?.outside).toBeDefined();
  });
});
