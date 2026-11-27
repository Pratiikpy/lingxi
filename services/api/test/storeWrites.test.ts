/**
 * A123: stores write only what changed, clear what a crashed write left behind, and hold their daily character limits
 * for an IPv6 /48 as well as for an address.
 */
import { existsSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ZERO_HASH, chainAll, encodeChallenge, petCard, type DuelPet } from "@lingxi/game";
import { createArenaStore } from "../src/arena";
import { createDiaryStore } from "../src/diaries";
import { createDuelStore, withDuels } from "../src/duels";
import { PREFIX_SHARE, RateLimiter } from "../src/limit";
import { createSeasonStore } from "../src/season";

const tmp = () => mkdtempSync(join(tmpdir(), "lx-store-"));
const T = Date.UTC(2026, 10, 18, 12);
const WEEK_MS = 7 * 86_400_000;
const seasonPet = (name: string) => ({
  name,
  line: "gentle",
  stage: "child",
  card: petCard({ lessons: [] }),
  story: { days: 1, lessons: 0, nature: [] },
});
const OLD = 1_000_000_000;

describe("the season keeps one file a week and writes only the week that changed (A123)", () => {
  it("an entry rewrites its own week's file and leaves the others alone", () => {
    const dir = tmp();
    const file = join(dir, "season.json");
    let now = T - WEEK_MS;
    const store = createSeasonStore(file, () => now);
    expect(store.enter(seasonPet("Last"), "device-last-0001").ok).toBe(true);
    now = T;
    expect(store.enter(seasonPet("This"), "device-this-0001").ok).toBe(true);
    const files = readdirSync(`${file}.d`).sort();
    expect(files).toEqual(["2026-W46.json", "2026-W47.json"]);
    utimesSync(join(`${file}.d`, "2026-W46.json"), OLD, OLD);
    expect(store.enter(seasonPet("More"), "device-more-0001").ok).toBe(true);
    expect(statSync(join(`${file}.d`, "2026-W46.json")).mtimeMs, "last week's file was not rewritten").toBe(OLD * 1000);
    // and everything reads back after a restart
    const again = createSeasonStore(file, () => now);
    expect(
      again
        .view("2026-W47")!
        .entries.map((e) => e.pet.name)
        .sort(),
    ).toEqual(["More", "This"]);
    expect(again.view("2026-W46")!.entries.map((e) => e.pet.name)).toEqual(["Last"]);
  });

  it("moves a store kept as one file into a file a week, and keeps the old file aside", () => {
    const dir = tmp();
    const file = join(dir, "season.json");
    const before = createSeasonStore(undefined, () => T);
    before.enter(seasonPet("Kept"), "device-kept-0001");
    writeFileSync(
      file,
      JSON.stringify({
        "2026-W47": before.view("2026-W47") ? { entries: before.view("2026-W47")!.entries, by: {} } : {},
      }),
    );
    const store = createSeasonStore(file, () => T);
    expect(store.view("2026-W47")!.entries.map((e) => e.pet.name)).toEqual(["Kept"]);
    expect(existsSync(join(`${file}.d`, "2026-W47.json"))).toBe(true);
    expect(existsSync(`${file}.before-weeks`), "the old file is kept aside, never deleted").toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});

describe("the arena writes only the rounds that changed (A123)", () => {
  it("a new line rewrites its round's file and no other", async () => {
    const dir = tmp();
    const file = join(dir, "arena.json");
    const store = createArenaStore(file, () => T, { every: 0 });
    store.save(1, seasonPet("One"), [], "device-one-00001");
    store.save(2, seasonPet("Two"), [], "device-two-00001");
    await store.flush();
    // the rounds' files, beside the folder of the cards their lines carry (P10)
    expect(readdirSync(`${file}.d`).sort()).toEqual(["1.json", "2.json", "cards"]);
    utimesSync(join(`${file}.d`, "1.json"), OLD, OLD);
    store.save(2, seasonPet("Two again"), [], "device-two-00002");
    await store.flush();
    expect(statSync(join(`${file}.d`, "1.json")).mtimeMs, "round 1 was not rewritten").toBe(OLD * 1000);
    const again = createArenaStore(file, () => T, { every: 0 });
    expect([again.count(1), again.count(2)]).toEqual([1, 2]);
  });
});

describe("what a crashed write left behind is cleared on open (A123)", () => {
  it("stray temporary files go from the duel, diary, season and arena folders", () => {
    const duels = tmp();
    writeFileSync(join(duels, "abcdefabcdefabcd.tmp"), "half");
    createDuelStore(duels);
    expect(readdirSync(duels).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const diaries = tmp();
    writeFileSync(join(diaries, "7.json.tmp"), "half");
    createDiaryStore(diaries);
    expect(readdirSync(diaries).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const seasonDir = tmp();
    const season = join(seasonDir, "season.json");
    createSeasonStore(season, () => T);
    writeFileSync(join(`${season}.d`, "2026-W47.json.tmp"), "half");
    createSeasonStore(season, () => T);
    expect(readdirSync(`${season}.d`).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const arenaDir = tmp();
    const arena = join(arenaDir, "arena.json");
    createArenaStore(arena, () => T, { every: 0 });
    writeFileSync(join(`${arena}.d`, "3.json.tmp"), "half");
    createArenaStore(arena, () => T, { every: 0 });
    expect(readdirSync(`${arena}.d`).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("the daily character limits hold for an IPv6 /48 too (A123)", () => {
  const duelPet = (name: string): DuelPet => ({
    name,
    line: "gentle",
    stage: "adult",
    card: petCard({ lessons: [] }),
    story: { days: 9, lessons: 0, nature: [] },
  });
  const code = (n: number) =>
    encodeChallenge({ id: `abcdef01234567${String(n).padStart(2, "0")}`, from: duelPet("Mochi"), at: n });

  it("duel links: one /48 stores four addresses' worth a day, and another caller is not held up", async () => {
    const t = Date.UTC(2026, 10, 20, 9);
    const app = withDuels(new Hono(), createDuelStore(), new RateLimiter(1000, 60_000), () => t, code(1).length + 50);
    const post = async (ip: string, c: string) =>
      (await (
        await app.request("/api/duels", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({ code: c }),
        })
      ).json()) as { ok: boolean; reason?: string };
    const got: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = await post(`2001:db8:123:${i.toString(16)}::1`, code(i));
      got.push(r.ok ? "ok" : (r.reason ?? ""));
    }
    expect(got.filter((x) => x === "ok").length).toBe(PREFIX_SHARE);
    expect((await post("198.51.100.23", code(20))).ok).toBe(true);
  });

  it("diaries: one /48 publishes four addresses' worth of bytes a day", () => {
    const store = createDiaryStore(undefined, { now: () => T, perAddressBytesPerDay: 50_000 });
    const log = (petId: string) => {
      const w = Array.from({ length: 4_000 }, (_, i) => (i * 7_919 + Number(petId)) & 0xffff);
      return { log: { petId, words: w, segments: [{ brainId: "1", words: w }] }, hash: chainAll(ZERO_HASH, w) };
    };
    const born = Math.floor(T / 1000) - 30 * 86_400;
    const got: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const d = log(String(100 + i));
      const r = store.publish(d.log, { logHash: d.hash, born }, `2001:db8:124:${i.toString(16)}::/64`);
      got.push(r.ok ? "ok" : r.reason);
    }
    const one = JSON.stringify(log("101").log).length;
    expect(got.filter((x) => x === "ok").length, `${one} bytes a diary`).toBe(
      Math.floor((50_000 * PREFIX_SHARE) / one),
    );
    const d = log("200");
    expect(store.publish(d.log, { logHash: d.hash, born }, "198.51.100.24").ok).toBe(true);
  });
});
