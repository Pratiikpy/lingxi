import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { buildTree, type TreePet } from "../src/tree";
import { withTree } from "../src/server";

const pet = (id: string, owner: string, parents: [string, string] | null = null, block = Number(id)): TreePet => ({ id, line: 0, owner, parents, children: [], block, tx: "0x", at: 0 });

describe("the tree of life", () => {
  it("counts generations, ancestors and the owners who raised them", () => {
    const t = buildTree([pet("1", "0xA"), pet("2", "0xB"), pet("3", "0xC", ["1", "2"]), pet("4", "0xD"), pet("5", "0xA", ["3", "4"])]);
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
    const j = (await (await app.request("/api/tree")).json()) as { ok: boolean; indexedTo: number; pets: Array<{ id: string; name?: string; generation: number }> };
    expect(j.ok).toBe(true);
    expect(j.indexedTo).toBe(99);
    expect(j.pets.map((p) => [p.id, p.name ?? null, p.generation])).toEqual([["1", "Mochi", 0], ["2", null, 0], ["3", "Bean", 1]]);
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
    const read = async () => ((await (await app.request("/api/tree")).json()) as { pets: Array<{ id: string; colour?: number }> }).pets.map((p) => [p.id, p.colour ?? 0]);
    expect(await read()).toEqual([["1", 0], ["2", 0]]);
    down = false;
    expect(await read()).toEqual([["1", 4], ["2", 0]]);
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
