import { describe, expect, it } from "vitest";
import { EXPRESSIONS } from "@lingxi/art";
import { buildLayers, composeLook, gameSprite, lookOf } from "../src/look";

const built = buildLayers();

describe("the on-chain picture is the game's own art", () => {
  it("every stage, every face, trace lit and unlit: the layered picture equals the game sprite pixel for pixel", () => {
    let checked = 0;
    for (let stage = 1; stage <= 4; stage++)
      for (const expression of EXPRESSIONS)
        for (const lit of [false, true]) {
          const look = { stage, expression, lit };
          expect(composeLook(look, built).px, `${stage} ${expression} ${lit}`).toEqual(gameSprite(look).px);
          checked++;
        }
    expect(composeLook({ stage: 0, expression: "neutral", lit: false }, built).px).toEqual(gameSprite({ stage: 0, expression: "neutral", lit: false }).px);
    expect(checked).toBe(128);
  });

  it("fits comfortably on chain", () => {
    const bytes = built.layers.reduce((n, l) => n + (l.data.length - 2) / 2, 0);
    expect(built.layers).toHaveLength(1 + 4 + 4 + 32);
    expect(bytes).toBeLessThan(24_000);
  });

  it("chooses the face from the saved state the way the contract does", () => {
    const at = (fields: Record<number, [number, number]>) => Object.entries(fields).reduce((w, [pos, [n, v]]) => w | (BigInt(v) << BigInt(pos)), 0n) | (BigInt(n0) << 0n);
    const n0 = 0;
    const meters = (food: number, joy: number, energy: number) => ({ 64: [10, food], 74: [10, joy], 84: [10, energy] }) as Record<number, [number, number]>;
    const st = (stage: number, f: Record<number, [number, number]>) => at({ ...f, 148: [3, stage] });
    expect(lookOf(st(2, meters(800, 900, 900)))).toEqual({ stage: 2, expression: "sparkly", lit: true });
    expect(lookOf(st(3, meters(800, 600, 900)))).toEqual({ stage: 3, expression: "happy", lit: false });
    expect(lookOf(st(3, meters(100, 900, 900))).expression).toBe("sad");
    expect(lookOf(st(3, meters(800, 900, 100))).expression).toBe("sleepy");
    expect(lookOf(st(3, meters(800, 100, 900))).expression).toBe("sulk");
    expect(lookOf(st(3, { ...meters(800, 900, 900), 219: [1, 1] })).expression).toBe("dizzy");
    expect(lookOf(st(3, { ...meters(800, 900, 900), 151: [1, 1] })).expression).toBe("asleep");
    expect(lookOf(st(5, meters(800, 400, 900)))).toEqual({ stage: 4, expression: "neutral", lit: false });
  });
});
