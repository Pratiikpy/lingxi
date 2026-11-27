/**
 * P10: only the open week of the season is held in memory. Each entry carries its pet's whole card (up to 34,000
 * characters), so twelve weeks of 64 entries held 34 MB at the cap. A week that has closed keeps in memory only what is
 * asked of it often (its standings, its keepsake, how many entered); its entries stay in its file, read when the week
 * is asked for, and a finished week's answer is written once beside it and served as written.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { compileProgram, netlistBytes, validateProgram } from "@lingxi/brain";
import { petCard } from "@lingxi/game";
import { withSeason } from "../src/server";
import { createSeasonStore, settleAwards } from "../src/season";
import { bytesEach } from "./heap";

const T = Date.UTC(2026, 10, 18, 12); // Wednesday of 2026-W47
const WEEK = 7 * 86_400_000;
const CPU = `0x${"c".repeat(40)}`;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const instinct = hex(
  netlistBytes(
    compileProgram(
      validateProgram({
        version: "LX-PET/1",
        memory: [],
        rules: [{ when: { event: [3] }, then: { want: 4, mood: 0 } }],
        otherwise: { want: 0, mood: 1 },
      }),
    ),
  ),
);
/** a card of about 20,000 characters: a real instinct and a part carried beside it */
const bigPet = (name: string, i: number) => ({
  name,
  line: "gentle",
  stage: "child",
  card: petCard({
    lessons: [],
    outside: {
      processor: CPU,
      id: "9",
      owner: `0x${"d".repeat(40)}`,
      parts: [
        { processor: CPU, id: "9", nIn: 16, nOut: 8, hex: instinct },
        { processor: CPU, id: "10", nIn: 16, nOut: 8, hex: i.toString(16).padStart(20_000, "0") },
      ],
    },
  } as never),
  story: { days: 1, lessons: 0, nature: [] },
});
const fileIn = () => join(mkdtempSync(join(tmpdir(), "season-p10-")), "season.json");

describe("only the open week of the season in memory (P10)", () => {
  it("holds the open week's entries, and of each closed week its standings alone", async () => {
    const perWeek = 20;
    /** four weeks of twenty 20 KB cards, each week read back once it has closed: what the store then holds */
    const held = async (file: string | undefined) => {
      let t = T;
      // counted here and checked after the reading: an expect() holds what it was given
      const entered: boolean[] = [];
      const counts: number[] = [];
      const [bytes, store] = await bytesEach(
        1,
        () => createSeasonStore(file, () => t),
        (s) => {
          for (let w = 0; w < 4; w++) {
            for (let k = 0; k < perWeek; k++)
              entered.push(s.enter(bigPet(`P${w}x${k}`, w * 100 + k), `device-${w}-${k}-xxxx`).ok);
            t += WEEK;
          }
          for (const week of s.weeks()) counts.push(s.view(week)?.entries.length ?? 0);
        },
      );
      expect(entered.every(Boolean)).toBe(true);
      expect(counts).toEqual([perWeek, perWeek, perWeek, perWeek]);
      expect(store.weeks()).toHaveLength(4);
      return bytes;
    };
    // with no file to read them back from, every week is held whole, as all were before (about 1.6 MB of cards)
    const whole = await held(undefined);
    const kept = await held(fileIn());
    expect(whole).toBeGreaterThan(1_500_000);
    expect(kept).toBeLessThan(whole / 2);
  });

  it("serves a closed week as it was before it closed, and after a restart", async () => {
    let t = T;
    const file = fileIn();
    const store = createSeasonStore(file, () => t);
    for (let k = 0; k < 5; k++) store.enter(bigPet(`Pet${k}`, k), `device-pet0000${k}`, k === 2 ? { petId: "22" } : {});
    const open = store.view("2026-W47");
    t += WEEK;
    const closed = store.view("2026-W47");
    expect(closed).toEqual({ ...open, closed: true });
    expect(createSeasonStore(file, () => t).view("2026-W47")).toEqual(closed);
    // a keepsake given to a closed week is kept with it, in memory and on disk
    await settleAwards(store, async () => ({
      ok: true as const,
      brainId: "7",
      to: "0x7",
      tapeTx: "0xa",
      sendTx: "0xb",
    }));
    expect(store.view("2026-W47")?.award).toMatchObject({ brainId: "7" });
    expect(createSeasonStore(file, () => t).view("2026-W47")?.award).toMatchObject({ brainId: "7" });
    expect(store.pending()).toEqual([]);
  });

  it("writes a finished week's answer once and serves it as written", async () => {
    let t = T;
    const file = fileIn();
    const store = createSeasonStore(file, () => t);
    const app = withSeason(new Hono(), store, undefined, () => t);
    for (let k = 0; k < 3; k++) store.enter(bigPet(`Pet${k}`, k), `device-pet0000${k}`);
    t += WEEK;
    // closed, but its keepsake not yet settled: answered, not yet kept
    const before = await (await app.request("/api/season/2026-W47")).text();
    expect(readdirSync(`${file}.d`).filter((n) => n.endsWith(".answer"))).toEqual([]);
    await settleAwards(store, async () => ({ ok: false as const }));
    const settled = await (await app.request("/api/season/2026-W47")).text();
    expect(JSON.parse(settled)).toMatchObject({ ok: true, closed: true, award: { none: "noWallet" } });
    expect(JSON.parse(before).entries).toEqual(JSON.parse(settled).entries);
    expect(existsSync(join(`${file}.d`, "2026-W47.answer"))).toBe(true);
    const again = await app.request("/api/season/2026-W47");
    expect(await again.text()).toBe(settled);
    expect(again.headers.get("cache-control")).toBe("public, max-age=3600");
  });
  it("never writes over a closed week it cannot read, and remembers a keepsake given meanwhile beside it", async () => {
    let t = T;
    const file = fileIn();
    const store = createSeasonStore(file, () => t);
    for (let k = 0; k < 3; k++) store.enter(bigPet(`Pet${k}`, k), `device-pet0000${k}`);
    t += WEEK;
    expect(store.view("2026-W47")?.entries).toHaveLength(3);
    const shard = join(`${file}.d`, "2026-W47.json");
    const original = readFileSync(shard, "utf8");
    writeFileSync(shard, "{cut");
    writeFileSync(`${shard}.bak`, "{cut");
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      store.award("2026-W47", {
        key: "k",
        name: "Pet0",
        tries: 1,
        brainId: "7",
        to: "0x7",
        tapeTx: "0xa",
        sendTx: "0xb",
      });
      expect(store.view("2026-W47"), "a week it cannot read is not answered as an empty one").toBeNull();
      const app = withSeason(new Hono(), store, undefined, () => t);
      expect((await app.request("/api/season/2026-W47")).status).toBe(503);
    } finally {
      spy.mockRestore();
    }
    // nothing was written where the week was; both copies were kept aside as they were
    expect(existsSync(shard)).toBe(false);
    expect(readdirSync(`${file}.d`).filter((n) => n.startsWith("2026-W47.json.damaged-"))).toHaveLength(2);
    // put back, the week comes back whole, with its keepsake: never given twice
    writeFileSync(shard, original);
    const again = createSeasonStore(file, () => t);
    expect(again.view("2026-W47")?.entries).toHaveLength(3);
    expect(again.view("2026-W47")?.award).toMatchObject({ brainId: "7" });
    expect(again.pending()).toEqual([]);
  });
});
