import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, gateCount, stateBits } from "@lingxi/brain";
import { COMPANIONS, COMPANION } from "../src/companions";
import { MAX_GATES } from "../src/lessons";
import { TEAM_ROUNDS, teamSpar, type TeamUnit } from "../src/team";

const unit = (id: string, program: import("@lingxi/brain").Program, hp: number, level = 0): TeamUnit => ({
  id,
  name: id,
  brain: fastBrain(compileProgram(program)),
  memory: new Array(stateBits(program)).fill(0),
  hp,
  level,
});
const comp = (id: string) => {
  const c = COMPANION[id]!;
  return unit(id, c.program, c.hp, c.level);
};

describe("team spars", () => {
  it("are deterministic for a seed and end within the round limit", () => {
    const a = [unit("pet", STARTERS.bold, 100), comp("sprig")];
    const b = [comp("bolt"), comp("shell")];
    const x = teamSpar(a, b, 7);
    expect(teamSpar(a, b, 7)).toEqual(x);
    expect(x.rounds.length).toBeGreaterThan(0);
    expect(x.rounds.length).toBeLessThanOrEqual(TEAM_ROUNDS);
    expect(x.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reject empty or oversized teams", () => {
    expect(() => teamSpar([], [comp("bolt")], 1)).toThrow();
    expect(() => teamSpar(new Array(6).fill(comp("bolt")), [comp("bolt")], 1)).toThrow();
  });

  it("only the front unit takes damage, and the next steps up when it faints", () => {
    const r = teamSpar([comp("pebble"), comp("pebble"), comp("pebble")], [comp("bolt"), comp("nova"), comp("ember")], 11);
    for (let i = 1; i < r.rounds.length; i++) {
      const prev = r.rounds[i - 1]!;
      const cur = r.rounds[i]!;
      for (const s of [0, 1] as const) {
        cur.hp[s].forEach((hp, u) => {
          if (u !== cur.fronts[s]) expect(hp).toBeGreaterThanOrEqual(prev.hp[s][u]!);
        });
        expect(cur.fronts[s]).toBeGreaterThanOrEqual(prev.fronts[s]);
        if (cur.fronts[s] > prev.fronts[s]) expect(prev.hp[s][prev.fronts[s]]).toBe(0);
      }
    }
  });

  it("fainted units make no moves", () => {
    const r = teamSpar([comp("sprig")], [comp("bolt"), comp("nova"), comp("ember")], 3);
    for (const round of r.rounds) for (const s of [0, 1] as const) round.moves[s].forEach((m, u) => {
      const before = round.n === 0 ? 1 : r.rounds[round.n - 1]!.hp[s][u]!;
      if (before === 0) expect(m).toBeNull();
    });
  });

  it("a bigger team beats a lone weak unit almost always", () => {
    let wins = 0;
    for (let s = 0; s < 40; s++) if (teamSpar([comp("bolt"), comp("shell"), comp("sprig")], [comp("sprig")], s * 97).winner === 0) wins++;
    expect(wins).toBeGreaterThanOrEqual(36);
  });

  it("a medic behind the front keeps it standing longer than an idle helper", () => {
    let healed = 0, plain = 0;
    for (let s = 0; s < 40; s++) {
      const foe = [comp("bolt"), comp("nova")];
      healed += teamSpar([comp("pebble"), comp("sprig")], foe, s).rounds.length;
      plain += teamSpar([comp("pebble"), unit("idle", { version: "LX-PET/1", memory: [], rules: [], otherwise: { want: 3, mood: 0 } } as never, 55)], foe, s).rounds.length;
    }
    expect(healed).toBeGreaterThan(plain);
  });
});

describe("companions", () => {
  it("every companion brain fits the gate budget and has unique id, name and a cost", () => {
    const ids = new Set(COMPANIONS.map((c) => c.id));
    expect(ids.size).toBe(COMPANIONS.length);
    for (const c of COMPANIONS) {
      expect(gateCount(compileProgram(c.program))).toBeLessThanOrEqual(MAX_GATES);
      expect(c.cost).toBeGreaterThan(0);
      expect(c.hp).toBeGreaterThan(0);
      expect(c.name.zh.length).toBeGreaterThan(0);
    }
  });

  it("each companion plays its role: moves it uses most match what it says it does", () => {
    const want: Record<string, string[]> = { sprig: ["gift", "snack", "rest"], bolt: ["pounce", "rest"], wisp: ["charm", "dodge", "pounce"], pebble: ["tap", "snack"] };
    for (const [id, moves] of Object.entries(want)) {
      const tally: Record<string, number> = {};
      for (let s = 0; s < 10; s++) {
        const r = teamSpar([comp(id), comp("pebble")], [comp("bolt"), comp("shell")], s);
        for (const round of r.rounds) { const m = round.moves[0][0]; if (m) tally[m] = (tally[m] ?? 0) + 1; }
      }
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]![0];
      expect(moves).toContain(top);
    }
  });
});
