import { describe, expect, it } from "vitest";
import { ROOMS, pickDrop, tierWeight } from "../src/world";

describe("finds are weighted by rarity tier", () => {
  it("a tier becomes the weight 2^(tier-1), and tier 0 never drops", () => {
    expect([0, 1, 2, 3, 7, 9].map(tierWeight)).toEqual([0, 1, 2, 4, 64, 256]);
  });

  it("every room drop carries its sheet tier and the weight made from it", () => {
    const drops = Object.values(ROOMS).flatMap((r) => r.drops);
    expect(drops.length).toBeGreaterThan(50);
    for (const d of drops) {
      expect(d.tier).toBeGreaterThanOrEqual(1);
      expect(d.tier).toBeLessThanOrEqual(9);
      expect(d.weight).toBe(tierWeight(d.tier));
    }
  });

  it("a tier-9 and a tier-7 item split 80% / 20%", () => {
    const room = ROOMS[1]!;
    expect(room.drops.map((d) => d.tier)).toEqual([9, 7]);
    const total = room.drops.reduce((s, d) => s + d.weight, 0);
    expect(room.drops[0]!.weight / total).toBeCloseTo(0.8, 5);
  });

  it("Night Poppy in a stick, cone and poppy room is a rare find, about 1.2%", () => {
    const room = ROOMS[9]!;
    const poppy = room.drops.find((d) => d.item === 1010)!;
    const total = room.drops.reduce((s, d) => s + d.weight, 0);
    expect(poppy.weight / total).toBeCloseTo(4 / 324, 6);
    expect(poppy.weight / total).toBeLessThan(0.013);
  });

  it("over 100,000 seeded picks every room's measured rates are within 1 point of the table", () => {
    const N = 100_000;
    for (const room of Object.values(ROOMS)) {
      if (!room.drops.length) continue;
      const total = room.drops.reduce((s, d) => s + d.weight, 0);
      const seen = new Map<number, number>();
      let x = room.index * 2654435761;
      for (let i = 0; i < N; i++) {
        x = (Math.imul(x ^ (x >>> 15), 2246822519) + i) >>> 0;
        const item = pickDrop(room.drops, x);
        seen.set(item, (seen.get(item) ?? 0) + 1);
      }
      for (const d of room.drops) {
        const measured = (seen.get(d.item) ?? 0) / N;
        const expected = room.drops.filter((e) => e.item === d.item).reduce((s, e) => s + e.weight, 0) / total;
        expect(Math.abs(measured - expected), `room ${room.index} item ${d.item}`).toBeLessThan(0.01);
      }
    }
  });
});
