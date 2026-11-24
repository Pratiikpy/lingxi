/**
 * A139, against the real stores: a file cut short by a crash is never written over empty. The library and a season week
 * read their `.bak`; the model budget takes the day as spent when nothing can be read; the relayer refuses to start
 * with a fresh budget, and starts from its `.bak` when there is one.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { PET_SCHOOL, petCard } from "@lingxi/game";
import { createLibrary, lessonKey } from "../src/library";
import { createSeasonStore } from "../src/season";
import { createTokenBudget } from "../src/tokenBudget";
import { BrainRelayer } from "../src/relayer";

const tmp = () => mkdtempSync(join(tmpdir(), "lx-crash-"));
const cut = (file: string) => writeFileSync(file, readFileSync(file, "utf8").slice(0, 20));
const T = Date.UTC(2026, 10, 18, 12);
const pet = (name: string) => ({
  name,
  line: "gentle",
  stage: "child",
  card: petCard({ lessons: [] }),
  story: { days: 1, lessons: 0, nature: [] },
});

describe("a store's file cut short by a crash (A139)", () => {
  afterEach(() => vi.useRealTimers());

  it("the library reads its .bak and keeps the cut file aside, never saving an empty shelf over it", async () => {
    vi.useFakeTimers();
    const file = join(tmp(), "library.json");
    const lib = createLibrary(file);
    lib.share(PET_SCHOOL[0]!.rule, "Bao", "198.51.100.1", 1);
    await vi.advanceTimersByTimeAsync(10_000);
    lib.share(PET_SCHOOL[1]!.rule, "Mei", "198.51.100.2", 2);
    await vi.advanceTimersByTimeAsync(10_000);
    cut(file);
    const again = createLibrary(file);
    expect(again.list().map((l) => l.key)).toEqual([lessonKey(PET_SCHOOL[0]!.rule)]);
    expect(readdirSync(join(file, "..")).some((n) => n.startsWith("library.json.damaged-"))).toBe(true);
  });

  it("a season week cut short is read from its .bak, and the next entry adds to it", () => {
    const file = join(tmp(), "season.json");
    const store = createSeasonStore(file, () => T);
    for (let i = 0; i < 3; i++) store.enter(pet(`P${i}`), `device-p-000${i}`);
    cut(join(`${file}.d`, "2026-W47.json"));
    const again = createSeasonStore(file, () => T);
    expect(again.view("2026-W47")!.entries.length, "the week as it was before the last entry").toBe(2);
    again.enter(pet("P3"), "device-p-0003");
    expect(createSeasonStore(file, () => T).view("2026-W47")!.entries.length).toBe(3);
  });

  it("the model budget takes the day as spent when its file and .bak cannot be read, never starts it again", () => {
    const file = join(tmp(), "budget.json");
    const b = createTokenBudget({ perDay: 2_000_000, file });
    b.spend(1_900_000);
    writeFileSync(file, "{");
    writeFileSync(`${file}.bak`, "[");
    const again = createTokenBudget({ perDay: 2_000_000, file });
    expect(again.allow()).toBe(false);
    expect(again.used()).toBe(2_000_000);
  });

  it("the relayer refuses to start on a store it cannot read, and starts from its .bak when there is one", () => {
    const dir = tmp();
    const storeFile = join(dir, "brains.json");
    const cfg = {
      rpc: "http://127.0.0.1:9",
      processor: "0x00000000000000000000000000000000000000cc" as const,
      key: generatePrivateKey(),
      storeFile,
      maxPerDay: 50,
    };
    writeFileSync(storeFile, '{"brains": {"ab": "7"}, "day": "2026-11-21", "used": 4');
    expect(() => new BrainRelayer(cfg)).toThrow(/could not be read/);
    expect(existsSync(storeFile), "the cut store is kept aside, not left to be written over").toBe(false);
    writeFileSync(`${storeFile}.bak`, JSON.stringify({ brains: { ab: "7" }, day: "2026-11-21", used: 3, hour: [] }));
    const r = new BrainRelayer(cfg);
    expect(r.usage(Date.UTC(2026, 10, 21, 12)).today, "the day's tape-outs from the .bak, not a fresh budget").toBe(3);
  });
});
