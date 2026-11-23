// @vitest-environment happy-dom
/**
 * P3: the scene asks for the pet's texture every frame; a frame already made is served from the cache without drawing
 * the pet's polygons again (drawing first and looking in the cache after cost the main thread every frame).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const drawn = vi.hoisted(() => ({ pet: 0, cat: 0 }));
vi.mock("pixi.js", () => ({ Texture: { from: () => ({ source: {} }) } }));
vi.mock("@lingxi/art", async (orig) => {
  const real = await orig<typeof import("@lingxi/art")>();
  return {
    ...real,
    drawPet: (...a: Parameters<typeof real.drawPet>) => (drawn.pet++, real.drawPet(...a)),
    drawCat: (...a: Parameters<typeof real.drawCat>) => (drawn.cat++, real.drawCat(...a)),
  };
});

beforeAll(() => {
  // happy-dom has no 2D canvas; the texture only needs somewhere to put its pixels
  HTMLCanvasElement.prototype.getContext = (() => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => {} })) as never;
});

describe("pet and cat textures (P3)", () => {
  it("draw a frame once, however many times the scene asks for it", async () => {
    const { petTexture, catTexture } = await import("./textures");
    const frame = { stage: "child" as const, expression: "happy" as const, breath: 0 as const, squash: 0 as const, lit: false };
    const a = petTexture("gentle", frame);
    for (let i = 0; i < 30; i++) expect(petTexture("gentle", { ...frame })).toBe(a);
    expect(drawn.pet).toBe(1);
    petTexture("gentle", { ...frame, breath: 1 });
    expect(drawn.pet).toBe(2);
    for (let i = 0; i < 30; i++) catTexture("sit0");
    expect(drawn.cat).toBe(1);
  });
});
