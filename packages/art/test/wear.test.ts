import { describe, expect, it } from "vitest";
import { FORMS, LINES, SETS, WEARABLES, drawPet, registeredWearables, registerWearables, setPieces, wearOverlay, wearableOf, type Line, type Wearable } from "../src/index";

const STAGES = ["baby", "child", "teen", "adult"] as const;

describe("wearables", () => {
  it("every piece uses only colours it names, and a face piece has a small drawing too", () => {
    for (const w of WEARABLES) {
      for (const rows of [w.rows, w.rowsSmall ?? []]) for (const row of rows) for (const ch of row) if (ch !== ".") expect(w.colors[ch], `${w.id} colour ${ch}`).toBeDefined();
      if (w.slot === "face") expect(w.rowsSmall, w.id).toBeDefined();
      expect(w.name.en.length * w.name.zh.length, w.id).toBeGreaterThan(0);
    }
  });

  it("every piece sits on every egg line, stage and adult form, inside the picture", () => {
    for (const w of WEARABLES) {
      for (const line of Object.keys(LINES) as Line[]) {
        const forms = [undefined, ...FORMS];
        for (const stage of STAGES) {
          for (const form of stage === "adult" ? forms : [undefined]) {
            const pet = drawPet(line, stage, form ? { form } : {});
            const px = wearOverlay(pet, line, stage, { [w.slot]: w.id }, 0, form);
            expect(px.length, `${w.id} on ${line} ${stage} ${form ?? ""}`).toBeGreaterThan(0);
            for (const [x, y] of px) {
              expect(x >= 0 && x < pet.w && y >= 0 && y < pet.h, `${w.id} on ${line} ${stage} ${form ?? ""} at ${x},${y}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("the limited tape-out pieces make a full set with a title", () => {
    const drop = setPieces("drop");
    expect(drop.map((w) => w.slot).sort()).toEqual(["face", "head", "held"]);
    expect(SETS.drop?.title.en).toBe("Tape-out engineer");
  });
});

describe("player-made pieces: the registered set", () => {
  const piece = (id: string): Wearable => ({ id, slot: "head", name: { en: id, zh: id }, rows: ["OO"], colors: { O: "#000000" } });

  it("holds the builders' pieces as soon as the package is loaded, so a quest reward draws on a pet", () => {
    for (const id of ["b:lamps13", "b:telescope", "b:hardhat", "b:handheld"]) expect(registeredWearables().has(id), id).toBe(true);
  });

  it("is a new set after each registration, and a set already read never changes", () => {
    const before = registeredWearables();
    registerWearables([piece("u:test-new")]);
    const after = registeredWearables();
    expect(after).not.toBe(before);
    expect(before.has("u:test-new")).toBe(false);
    expect(after.has("u:test-new")).toBe(true);
    expect(wearableOf("u:test-new")?.id).toBe("u:test-new");
    expect(wearableOf("u:test-new", before)).toBeUndefined();
  });

  it("draws a piece lent to one picture without registering it", () => {
    const canvas = drawPet("gentle", "child", {});
    const lent = new Map([["u:lent", piece("u:lent")]]);
    expect(wearOverlay(canvas, "gentle", "child", { head: "u:lent" }, 0, undefined, lent).length).toBeGreaterThan(0);
    expect(registeredWearables().has("u:lent")).toBe(false);
    expect(wearOverlay(canvas, "gentle", "child", { head: "u:lent" }).length).toBe(0);
  });
});
