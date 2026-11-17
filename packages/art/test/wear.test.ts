import { describe, expect, it } from "vitest";
import { FORMS, LINES, SETS, WEARABLES, drawPet, setPieces, wearOverlay, type Line } from "../src/index";

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
