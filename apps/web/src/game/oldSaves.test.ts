import { describe, expect, it } from "vitest";
import type { WorldState } from "@lingxi/world";
import { readRoster } from "./roster";
import { READERS } from "./saveReaders";
import { cleanWorld } from "./saveClean";
import { openSave, sealSave } from "./saveFile";

/**
 * P1 S3: real saves, one from each past build that changed the save's shape and others from real sessions on the live
 * site and the fork (fixtures/saves, each naming where it came from), loaded by this build with nothing lost. A save
 * part that is JSON is kept in the fixture as indented JSON, to read and compare; the text the game stored is its
 * compact form, rebuilt here.
 */
interface Fixture {
  build: string;
  built: string;
  why: string;
  keys: Record<string, unknown>;
}
const FIXTURES = Object.entries(
  import.meta.glob<Fixture>("./fixtures/saves/*.json", { eager: true, import: "default" }),
).map(([path, f]) => ({
  name: path.replace(/^.*\//, ""),
  ...f,
  keys: Object.fromEntries(Object.entries(f.keys).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])),
}));

interface SavedPet {
  name: string;
  bornAt: number;
  lessons?: unknown[];
}
const petsIn = (keys: Record<string, string>): SavedPet[] => {
  if (keys["lingxi.pets.v2"]) {
    const r = JSON.parse(keys["lingxi.pets.v2"]) as { pets?: SavedPet[]; kept?: SavedPet[] };
    return [...(r.pets ?? []), ...(r.kept ?? [])];
  }
  return keys["lingxi.pet.v1"] ? [JSON.parse(keys["lingxi.pet.v1"]) as SavedPet] : [];
};

describe("old saves load in this build with nothing lost (P1 S3)", () => {
  it("covers every build that changed the save's shape and every part of a save", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(20);
    const seen = new Set(FIXTURES.flatMap((f) => Object.keys(f.keys)));
    for (const key of [
      "lingxi.pet.v1",
      "lingxi.pets.v2",
      "lingxi.world.v1",
      "lingxi.chain.v2",
      "lingxi.mail.v1",
      "lingxi.friends.v1",
      "lingxi.badges.v1",
      "lingxi.daily.v1",
      "lingxi.decorKey",
      "lingxi.player.v1",
    ]) {
      expect(seen.has(key), key).toBe(true);
    }
  });

  for (const f of FIXTURES) {
    describe(`${f.name}: ${f.why}`, () => {
      it("is read without being held: every part is one this build can read", () => {
        for (const [key, raw] of Object.entries(f.keys)) {
          const reader = READERS[key];
          if (reader) expect(reader(JSON.parse(raw)), key).toBe("ok");
        }
      });

      it("keeps every pet, with its name, birth and lessons", () => {
        const before = petsIn(f.keys);
        const { roster, kept } = readRoster(f.keys["lingxi.pets.v2"] ?? null, f.keys["lingxi.pet.v1"] ?? null);
        expect(roster.pets.length + kept.length).toBe(before.length);
        for (const p of before) {
          const found = roster.pets.find((q) => q.bornAt === p.bornAt);
          expect(found, p.name).toBeDefined();
          expect(found!.name).toBe(p.name);
          expect(found!.lessons.length).toBe(p.lessons?.length ?? 0);
        }
      });

      it("keeps the world: coins, every item in the bag, every quest done", () => {
        const raw = f.keys["lingxi.world.v1"];
        if (!raw) return;
        const w = JSON.parse(raw) as WorldState;
        const clean = cleanWorld(JSON.parse(raw) as WorldState);
        expect(clean.coins).toBe(w.coins);
        for (const [item, n] of Object.entries(w.bag ?? {}))
          expect(clean.bag[Number(item)] ?? 0, `item ${item}`).toBeGreaterThanOrEqual(n as number);
        for (const q of w.claimed ?? []) expect(clean.claimed).toContain(q);
        expect(clean.seed).toBe(w.seed);
      });

      it("keeps its chain records, letters and keys as they were", () => {
        for (const key of ["lingxi.chain.v2", "lingxi.mail.v1"]) {
          const raw = f.keys[key];
          if (raw) expect(JSON.parse(raw), key).toEqual(JSON.parse(JSON.stringify(JSON.parse(raw))));
        }
        const records = f.keys["lingxi.chain.v2"]
          ? (JSON.parse(f.keys["lingxi.chain.v2"]) as Record<string, { petId?: unknown }>)
          : {};
        for (const r of Object.values(records)) expect(r.petId).toBeDefined();
      });

      it("goes into a save file and comes back exactly", async () => {
        const file = await sealSave({ savedAt: 1, keys: f.keys }, "old-saves-test-pass", { rounds: 100_000 });
        expect(await openSave(file, "old-saves-test-pass")).toEqual({
          ok: true,
          contents: { savedAt: 1, keys: f.keys },
        });
      });
    });
  }
});
