/**
 * P10: an arena line's card is kept on disk, not in memory. A round holds 60 lines, each its pet's whole card (up to
 * 34,000 characters), and 31 rounds held 49 MB at the cap. Each card is now also a file of its own, named by its digest,
 * read when a pick serves it (a few recent ones held); the round's file keeps its lines whole as before, cards and all.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileProgram, netlistBytes, validateProgram } from "@lingxi/brain";
import { canonicalCard, petCard } from "@lingxi/game";
import { createArenaStore } from "../src/arena";
import { bytesEach } from "./heap";

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
const bigCard = (i: number) =>
  petCard({
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
  } as never);
const pet = (name: string, i: number) => ({
  name,
  line: "gentle",
  stage: "adult",
  card: bigCard(i),
  story: { days: 1, lessons: 0, nature: [] },
});
const fileIn = () => join(mkdtempSync(join(tmpdir(), "arena-p10-")), "arena.json");
const ip = (i: number) => `10.6.${i >> 8}.${i & 255}`;

describe("an arena line's card kept on disk (P10)", () => {
  it("holds a line without its card, and a pick serves the card as it was saved", async () => {
    /** six full rounds of lines with 20 KB cards: what the store then holds a line */
    const held = async (file: string | undefined) => {
      // counted here and checked after the reading: an expect() holds what it was given
      const saved: boolean[] = [];
      const [each, store] = await bytesEach(
        360,
        () => createArenaStore(file, Date.now, { every: 0 }),
        (s) => {
          for (let r = 0; r < 6; r++)
            for (let i = 0; i < 60; i++)
              saved.push(
                s.save(r, pet(`Pet${i}`, r * 100 + i), [], `device-${r}-${i}-xxxx`, ip(r * 100 + (i >> 1))).ok,
              );
        },
      );
      expect(saved.every(Boolean)).toBe(true);
      expect(store.count(5)).toBe(60);
      expect(store.pick(3, "someone-else-0000", 0)?.pet.card).toBe(canonicalCard(bigCard(300)));
      return each;
    };
    // with no folder, every card is held, as all were before: about 22 KB a line
    const whole = await held(undefined);
    const kept = await held(fileIn());
    expect(whole).toBeGreaterThan(18_000);
    expect(kept).toBeLessThan(whole / 3);
  });

  it("keeps each round's file whole, cards and all, and serves the same lines after a restart", async () => {
    const file = fileIn();
    const store = createArenaStore(file, Date.now, { every: 0 });
    for (let i = 0; i < 5; i++) expect(store.save(7, pet(`Pet${i}`, i), [], `device-${i}-xxxxxx`, ip(i)).ok).toBe(true);
    await store.flush();
    const shard = JSON.parse(readFileSync(join(`${file}.d`, "7.json"), "utf8")) as Array<{ pet: { card: string } }>;
    expect(shard).toHaveLength(5);
    expect(shard.map((s) => s.pet.card)).toEqual([0, 1, 2, 3, 4].map((i) => canonicalCard(bigCard(i))));
    const again = createArenaStore(file, Date.now, { every: 0 });
    for (let k = 0; k < 5; k++)
      expect(again.pick(7, "someone-else-0000", k / 5)?.pet.card).toBe(canonicalCard(bigCard(k)));
  });

  it("lets a card's file go once no line holds it", async () => {
    const file = fileIn();
    const store = createArenaStore(file, Date.now, { every: 0 });
    const cards = () => readdirSync(join(`${file}.d`, "cards")).filter((x) => x.endsWith(".card"));
    expect(store.save(1, pet("A", 1), [], "device-a-xxxxxx", ip(1)).ok).toBe(true);
    expect(store.save(1, pet("B", 2), [], "device-b-xxxxxx", ip(2)).ok).toBe(true);
    expect(cards()).toHaveLength(2);
    // the same device's newer line replaces its older one, and the older card goes with it
    expect(store.save(1, pet("A2", 3), [], "device-a-xxxxxx", ip(1)).ok).toBe(true);
    expect(cards()).toHaveLength(2);
    // two lines with one card share its file
    expect(store.save(2, pet("C", 3), [], "device-c-xxxxxx", ip(3)).ok).toBe(true);
    expect(cards()).toHaveLength(2);
  });
});
