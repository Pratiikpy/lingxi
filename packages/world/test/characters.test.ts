import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/characters";
import { ROOMS } from "../src/world";

const ART = join(__dirname, "../../../apps/web/public/art/npcs");

describe("characters", () => {
  it("each stands in a real room, one per room, with unique ids", () => {
    const rooms = CHARACTERS.map((c) => c.room);
    expect(new Set(rooms).size).toBe(rooms.length);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) expect(ROOMS[c.room], c.id).toBeTruthy();
  });

  it("every portrait they use exists", () => {
    for (const c of CHARACTERS) {
      const faces = [
        c.stand,
        ...c.greeting.map((l) => l.face),
        c.bye.face,
        ...c.topics.flatMap((t) => t.lines.map((l) => l.face)),
      ];
      for (const f of faces) expect(existsSync(join(ART, f)), `${c.id}: ${f}`).toBe(true);
    }
  });

  it("everything they say exists in both languages and fits a speech bubble", () => {
    for (const c of CHARACTERS) {
      const lines = [...c.greeting, c.bye, ...c.topics.flatMap((t) => t.lines)];
      expect(c.topics.length).toBeGreaterThanOrEqual(2);
      for (const l of lines) {
        expect(l.en.trim().length, `${c.id}`).toBeGreaterThan(0);
        expect(l.zh.trim().length, `${c.id}`).toBeGreaterThan(0);
        expect(l.en.length, `${c.id}: ${l.en}`).toBeLessThanOrEqual(170);
      }
      for (const t of c.topics) expect(t.ask.en && t.ask.zh).toBeTruthy();
    }
  });
});
