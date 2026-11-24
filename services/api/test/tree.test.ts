import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { buildTree, type TreePet } from "../src/tree";
import { withTree } from "../src/server";

const pet = (id: string, owner: string, parents: [string, string] | null = null, block = Number(id)): TreePet => ({
  id,
  line: 0,
  owner,
  parents,
  children: [],
  block,
  tx: "0x",
  at: 0,
});

describe("the tree of life", () => {
  it("counts generations, ancestors and the owners who raised them", () => {
    const t = buildTree([
      pet("1", "0xA"),
      pet("2", "0xB"),
      pet("3", "0xC", ["1", "2"]),
      pet("4", "0xD"),
      pet("5", "0xA", ["3", "4"]),
    ]);
    const n = Object.fromEntries(t.pets.map((p) => [p.id, p]));
    expect([n["1"]!.generation, n["3"]!.generation, n["5"]!.generation]).toEqual([0, 1, 2]);
    expect(n["5"]!.ancestors).toEqual(["3", "4", "1", "2"]);
    expect(n["5"]!.designers).toEqual(["0xa", "0xc", "0xd", "0xb"]);
    expect(t).toMatchObject({ founders: 3, families: 2, generations: 3 });
  });

  it("a parent not on the chain counts as a founder, and bad loops are cut", () => {
    const t = buildTree([pet("7", "0xA", ["90", "91"]), pet("8", "0xB", ["9", "8"]), pet("9", "0xC", ["8", "7"])]);
    expect(t.pets.find((p) => p.id === "7")!.generation).toBe(1);
    expect(t.pets.every((p) => Number.isFinite(p.generation))).toBe(true);
  });

  it("an empty chain is an empty tree", () => {
    expect(buildTree([])).toEqual({ pets: [], founders: 0, families: 0, generations: 0 });
  });
});

describe("the tree route", () => {
  it("serves the tree with names, and survives a failing name read", async () => {
    const pets = [pet("1", "0xA"), pet("2", "0xB"), pet("3", "0xA", ["1", "2"])];
    const app = withTree(new Hono(), { pets: () => pets, head: () => 99 }, async (id) => {
      if (id === "2") throw new Error("node down");
      return id === "1" ? "Mochi" : "Bean";
    });
    const j = (await (await app.request("/api/tree")).json()) as {
      ok: boolean;
      indexedTo: number;
      pets: Array<{ id: string; name?: string; generation: number }>;
    };
    expect(j.ok).toBe(true);
    expect(j.indexedTo).toBe(99);
    expect(j.pets.map((p) => [p.id, p.name ?? null, p.generation])).toEqual([
      ["1", "Mochi", 0],
      ["2", null, 0],
      ["3", "Bean", 1],
    ]);
  });

  it("adds each pet's name colour from X Layer; a failed read leaves names plain and tries again", async () => {
    const pets = [pet("1", "0xA"), pet("2", "0xB")];
    let down = true;
    let asked: string[] = [];
    const app = withTree(new Hono(), { pets: () => pets, head: () => 9 }, undefined, async (ids) => {
      asked = ids;
      if (down) throw new Error("rpc");
      return { "1": 4, "2": 0 };
    });
    const read = async () =>
      ((await (await app.request("/api/tree")).json()) as { pets: Array<{ id: string; colour?: number }> }).pets.map(
        (p) => [p.id, p.colour ?? 0],
      );
    expect(await read()).toEqual([
      ["1", 0],
      ["2", 0],
    ]);
    down = false;
    expect(await read()).toEqual([
      ["1", 4],
      ["2", 0],
    ]);
    expect(asked).toEqual(["1", "2"]);
  });
});

describe("the tree's names are read once at a time, whoever asks (A52)", () => {
  it("two requests at an expiry make one read per stale pet, never more than eight at once", async () => {
    const pets = Array.from({ length: 30 }, (_, i) => pet(String(i + 1), "0xA"));
    let reads = 0;
    let open = 0;
    let most = 0;
    const app = withTree(new Hono(), { pets: () => pets, head: () => 99 }, async (id) => {
      reads++;
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return `Pet ${id}`;
    });
    const [a, b] = await Promise.all([app.request("/api/tree"), app.request("/api/tree")]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(reads).toBe(30);
    expect(most).toBeLessThanOrEqual(8);
    const names = ((await b.json()) as { pets: Array<{ id: string; name?: string }> }).pets.map((p) => p.name);
    expect(names.every((n) => n?.startsWith("Pet "))).toBe(true);
  });
});

describe("the tree stays cheap as it grows (A147)", () => {
  /** one bred line `n` pets deep: each pet the child of the one before and a founder of its own */
  const line = (n: number) => {
    const out: TreePet[] = [pet("1", "0xA"), pet("2", "0xB")];
    for (let i = 3; i <= n; i++) out.push(pet(String(i), `0x${i}`, [String(i - 1), String(i - 2)]));
    return out;
  };

  it("one bred line of 1,500 pets builds in seconds, not ages, with every ancestor once", () => {
    const t0 = performance.now();
    const t = buildTree(line(1_500));
    const took = performance.now() - t0;
    // the fault this guards walks every path to an ancestor, about 2^1500 of them in this line: it never finishes.
    // Built once per ancestor, the line takes about 0.3 s here and up to 1 s on a CI runner busy with every other
    // package's tests (1,045 ms seen 2026-11-24), so the limit is far above that and still nowhere near the fault
    expect(took, `${Math.round(took)} ms`).toBeLessThan(5_000);
    const last = t.pets.find((p) => p.id === "1500")!;
    expect(last.ancestors.length).toBe(1_499);
    expect(new Set(last.ancestors).size).toBe(1_499);
  });

  it("serves one built answer until the indexer moves on, and pages it for whoever asks", async () => {
    let head = 100;
    let pets = line(40);
    let calls = 0;
    const app = withTree(new Hono(), { pets: () => (calls++, pets), head: () => head });
    const a = await (await app.request("/api/tree")).text();
    const built = calls;
    const b = await (await app.request("/api/tree")).text();
    expect(b, "the same answer, not built again").toBe(a);
    pets = [...pets, pet("41", "0xNEW", ["40", "39"])];
    head = 101;
    const c = (await (await app.request("/api/tree")).json()) as { pets: Array<{ id: string }> };
    expect(
      c.pets.some((p) => p.id === "41"),
      "a new head builds it again",
    ).toBe(true);
    expect(calls).toBeGreaterThan(built);
    const page = (await (await app.request("/api/tree?after=10&limit=5")).json()) as {
      pets: Array<{ id: string }>;
      next?: string;
    };
    expect(page.pets.map((p) => p.id)).toEqual(["11", "12", "13", "14", "15"]);
    expect(page.next).toBe("15");
  });
});
