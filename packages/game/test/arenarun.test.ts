import { describe, expect, it } from "vitest";
import { COMPANION } from "../src/companions";
import { fighterFrom, fighterOfMind } from "../src/coach";
import { teamSpar, type TeamUnit } from "../src/team";
import {
  MAX_COMPANIONS,
  ROUND_COINS,
  START_HEARTS,
  TROPHIES_TO_WIN,
  SHOP_SIZE,
  battleSeed,
  buy,
  ghostHealth,
  ghostLevel,
  ghostTeam,
  outcome,
  pool,
  roll,
  runGrid,
  sell,
  settle,
  shift,
  startRun,
  toggleFreeze,
  type RunState,
  type RunStep,
} from "../src/arenarun";
import { slow } from "./slow";

const ok = (r: RunStep): RunState => {
  if (!r.ok) throw new Error(r.why);
  return r.state;
};

describe("arena runs", () => {
  it("start with 10 coins, 5 hearts and a full shop from the cheap pool", () => {
    const s = startRun(42);
    expect(s.coins).toBe(ROUND_COINS);
    expect(s.hearts).toBe(START_HEARTS);
    expect(s.shop.every((id) => id && pool(0).includes(id))).toBe(true);
    expect(startRun(42)).toEqual(s);
  });

  it("buying spends the price, joins the team and empties the slot", () => {
    const s = startRun(1);
    const id = s.shop[0]!;
    const t = ok(buy(s, 0));
    expect(t.coins).toBe(ROUND_COINS - COMPANION[id]!.cost);
    expect(t.team).toEqual([id]);
    expect(t.shop[0]).toBeNull();
    expect(buy(t, 0)).toEqual({ ok: false, why: "empty" });
  });

  it("refuses to buy without coins or room", () => {
    let s: RunState = { ...startRun(2), coins: 1 };
    expect(buy(s, 0)).toEqual({ ok: false, why: "coins" });
    s = { ...startRun(2), team: new Array(MAX_COMPANIONS).fill("pebble") };
    expect(buy(s, 0)).toEqual({ ok: false, why: "full" });
  });

  it("rolling costs a coin, keeps frozen offers and is reproducible", () => {
    const s = ok(toggleFreeze(startRun(5), 1));
    const r = ok(roll(s));
    expect(r.coins).toBe(ROUND_COINS - 1);
    expect(r.shop[1]).toBe(s.shop[1]);
    expect(ok(roll(s))).toEqual(r);
    const many = new Set<string>();
    let x = startRun(5);
    for (let i = 0; i < 8; i++) { x = ok(roll(x)); many.add(x.shop.join()); }
    expect(many.size).toBeGreaterThan(3);
  });

  it("frozen offers carry into the next round", () => {
    const s = ok(toggleFreeze(startRun(9), 2));
    expect(settle(s, 1).shop[2]).toBe(s.shop[2]);
  });

  it("selling gives a coin back; shifting reorders the line", () => {
    let s = ok(buy(ok(buy(startRun(3), 0)), 1));
    const [a, b] = s.team;
    s = ok(shift(s, 1, -1));
    expect(s.team).toEqual([b, a]);
    const before = s.coins;
    s = ok(sell(s, 0));
    expect(s.team).toEqual([a]);
    expect(s.coins).toBe(before + 1);
    expect(shift(s, 0, -1).ok).toBe(false);
  });

  it("ten wins is a won run, five losses a lost run, and nothing works after", () => {
    let s = startRun(7);
    for (let i = 0; i < TROPHIES_TO_WIN; i++) s = settle(s, 1);
    expect(outcome(s)).toBe("won");
    expect(roll(s)).toEqual({ ok: false, why: "over" });
    let l = startRun(7);
    for (let i = 0; i < 4; i++) l = settle(l, -1);
    expect(outcome(l)).toBe("playing");
    l = settle(settle(l, 0), -1);
    expect(outcome(l)).toBe("lost");
    expect(runGrid(l)).toBe("💔💔💔💔🤝💔");
  });

  it("ghost teams grow with the round and stay within the line size", () => {
    expect(ghostTeam(1, 0)).toHaveLength(1);
    expect(ghostTeam(1, 3).length).toBeGreaterThan(ghostTeam(1, 0).length);
    for (let r = 0; r < 15; r++) expect(ghostTeam(1, r).length).toBeLessThanOrEqual(MAX_COMPANIONS + 1);
    expect(ghostTeam(1, 4)).toEqual(ghostTeam(1, 4));
    expect(ghostTeam(1, 6)).toHaveLength(MAX_COMPANIONS + 1);
  });

  it("ghost veterans get a level edge from round 3, capped at 3", () => {
    expect([0, 2, 3, 6, 9, 30].map(ghostLevel)).toEqual([0, 0, 1, 2, 3, 3]);
  });
});

describe("arena runs stay fair on the spar's rules (B3c)", () => {
  it("a player who buys whatever fits each round wins between a fifth and a half of its runs, as under LX-TEAM/1", () => {
    const unitOf = (id: string, i: number, edge = 0): TeamUnit => {
      const c = COMPANION[id]!;
      const f = fighterFrom(c.name.en, c.program, Math.min(3, c.level + edge));
      return { id: `${id}:${i}`, name: c.name.en, brain: f.brain, memory: f.memory, hp: ghostHealth(c.hp, edge), level: f.level };
    };
    let won = 0;
    const N = 60;
    for (let seed = 1; seed <= N; seed++) {
      const line = (["gentle", "bold", "curious"] as const)[seed % 3]!;
      let s = startRun(seed * 7919);
      for (let k = 0; k < 40 && outcome(s) === "playing"; k++) {
        for (let tries = 0; tries < 6; tries++) for (let slot = 0; slot < SHOP_SIZE; slot++) {
          const r = buy(s, slot);
          if (r.ok) s = r.state;
        }
        const pet = fighterOfMind("pet", { line, lessons: [] }, 1);
        const mine: TeamUnit[] = [{ id: "pet", name: "pet", brain: pet.brain, memory: pet.memory, hp: 100, level: 1 }, ...s.team.map((id, i) => unitOf(id, i))];
        const theirs = ghostTeam(s.seed, s.round).map((id, i) => unitOf(id, i, ghostLevel(s.round)));
        const r = teamSpar(mine, theirs, battleSeed(s));
        s = settle(s, r.winner === 0 ? 1 : r.winner === 1 ? -1 : 0);
      }
      if (outcome(s) === "won") won++;
    }
    expect(won / N).toBeGreaterThan(0.2);
    expect(won / N).toBeLessThan(0.5);
  }, slow(120_000));
});
