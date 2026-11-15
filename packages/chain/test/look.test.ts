import { describe, expect, it } from "vitest";
import { EXPRESSIONS } from "@lingxi/art";
import { LOOK_LINES, buildLayers, composeLook, gameSprite, lookOf } from "../src/look";

const built = buildLayers();

describe("the on-chain picture is the game's own art", () => {
  it("every line, every stage, every face, trace lit and unlit: the layered picture equals the game sprite pixel for pixel", () => {
    let checked = 0;
    for (let line = 0; line < LOOK_LINES.length; line++)
      for (let stage = 1; stage <= 4; stage++)
        for (const expression of EXPRESSIONS)
          for (const lit of [false, true]) {
            const look = { line, stage, expression, lit };
            expect(composeLook(look, built).px, `${LOOK_LINES[line]} ${stage} ${expression} ${lit}`).toEqual(gameSprite(look).px);
            checked++;
          }
    const egg = { line: 0, stage: 0, expression: "neutral" as const, lit: false };
    expect(composeLook(egg, built).px).toEqual(gameSprite(egg).px);
    expect(checked).toBe(3 * 128);
  });

  it("fits comfortably on chain", () => {
    const bytes = built.layers.reduce((n, l) => n + (l.data.length - 2) / 2, 0);
    expect(bytes).toBeLessThan(24_000);
    expect(built.anchors).toHaveLength(12);
    expect(built.frames).toHaveLength(13);
  });

  it("chooses line, stage and face from the saved state the way the contract does", () => {
    const m = (stage: number, food: number, joy: number, energy: number, extra = 0n, line = 0) =>
      (BigInt(food) << 64n) | (BigInt(joy) << 74n) | (BigInt(energy) << 84n) | (BigInt(stage) << 148n) | (BigInt(line) << 152n) | extra;
    expect(lookOf(m(2, 800, 900, 900))).toEqual({ line: 0, stage: 2, expression: "sparkly", lit: true });
    expect(lookOf(m(3, 800, 600, 900, 0n, 1))).toEqual({ line: 1, stage: 3, expression: "happy", lit: false });
    expect(lookOf(m(3, 100, 900, 900, 0n, 2)).expression).toBe("sad");
    expect(lookOf(m(3, 800, 900, 100)).expression).toBe("sleepy");
    expect(lookOf(m(3, 800, 100, 900)).expression).toBe("sulk");
    expect(lookOf(m(3, 800, 900, 900, 1n << 219n)).expression).toBe("dizzy");
    expect(lookOf(m(3, 800, 900, 900, 1n << 151n)).expression).toBe("asleep");
    expect(lookOf(m(5, 800, 400, 900))).toEqual({ line: 0, stage: 4, expression: "neutral", lit: false });
    expect(lookOf(m(3, 800, 400, 900, 0n, 3)).line).toBe(0);
  });
});
