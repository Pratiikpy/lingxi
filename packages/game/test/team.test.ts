import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, fastBrain, gateCount, stateBits } from "@lingxi/brain";
import { COMPANIONS, COMPANION } from "../src/companions";
import { MAX_GATES } from "../src/lessons";
import { TEAM_ROUNDS, TEAM_V2, TEAM_VERSION, teamSpar, type TeamUnit } from "../src/team";
import { fighterFrom } from "../src/coach";

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

describe("team spar records", () => {
  it("keep each unit's senses word and stamina, so any unit's moves can be re-checked from its brain alone", () => {
    const pet = unit("pet", STARTERS.curious, 100, 1);
    const r = teamSpar([pet, comp("sprig")], [comp("bolt"), comp("wisp")], 99);
    const st = new Uint8Array(pet.memory.length);
    for (const round of r.rounds) {
      const w = round.words[0][0]!;
      if (w < 0) break;
      const want = ["tap", "snack", "pounce", "rest", "dodge", "guard", "charm", "gift"][pet.brain.step(st, w) & 7]!;
      const allowed = round.stamina[0][0]! <= 0 && want !== "rest" && want !== "tap" ? "rest" : want;
      const made = round.moves[0][0];
      expect(made === allowed || (allowed === "pounce" && made === "tap")).toBe(true);
    }
  });
});

/** LX-TEAM/1 fingerprints recorded before LX-TEAM/2 (row B3c) and identical after it: every team battle fought in it replays. */
const TEAM_V1_PINS: [number, string][] = [
  [0, "9f082d7e"],
  [1, "0fc47eeb"],
  [2, "59c27baf"],
  [3, "72009bc8"],
  [4, "39e4a6f4"],
  [5, "7c1a9782"],
  [6, "3843c443"],
  [7, "b16f63c3"],
  [8, "3e196ace"],
  [9, "c38c26f1"],
  [10, "f492cbd1"],
  [11, "9940299a"],
  [12, "33265447"],
  [13, "88c8f44f"],
  [14, "9ef338eb"],
  [15, "d4525c52"],
  [16, "3b6e72ec"],
  [17, "c0801436"],
  [18, "283ff592"],
  [19, "bf1f78c1"],
  [20, "fcb85c3e"],
  [21, "faea9bf2"],
  [22, "65aa3587"],
  [23, "7c24b6fb"],
  [24, "73313617"],
  [25, "7416bd8d"],
  [26, "70cb8ab3"],
  [27, "17600dd6"],
  [28, "12cd1ab2"],
  [29, "7ca33bec"]
];

describe("team battle versions (B3c)", () => {
  const unitOf = (id: string, program: Parameters<typeof fighterFrom>[1], hp: number, level = 0) => {
    const f = fighterFrom(id, program, level);
    return { id, name: id, brain: f.brain, memory: f.memory, hp, level };
  };
  it("LX-TEAM/1 replays every recorded battle to the same fingerprint", () => {
    for (const [s, digest] of TEAM_V1_PINS) {
      const a = [unitOf("pet", STARTERS[(["gentle", "bold", "curious"] as const)[s % 3]!], 100, s % 2), ...COMPANIONS.slice(0, s % 4).map((c) => unitOf(c.id, c.program, c.hp, c.level))];
      const b = COMPANIONS.slice(s % 3, (s % 3) + 1 + (s % 4)).map((c) => unitOf(c.id, c.program, c.hp, c.level));
      const r = teamSpar(a, b, s * 101 + 7, TEAM_VERSION);
      expect(r.version).toBe(TEAM_VERSION);
      expect(r.digest, `team ${s}`).toBe(digest);
    }
  });

  it("new battles are LX-TEAM/2, where a guarding or dodging front can beat a pouncing one (the spar's triangle)", () => {
    const only = (want: number) => ({ version: "LX-PET/1", memory: [], rules: [], otherwise: { want, mood: 1 } }) as never;
    const rate = (want: number) => {
      let w = 0;
      for (let s = 0; s < 200; s++) if (teamSpar([unitOf("me", only(want), 100)], [unitOf("pouncer", only(2), 100)], s).winner === 0) w++;
      return w / 200;
    };
    expect(teamSpar([unitOf("a", only(0), 100)], [unitOf("b", only(0), 100)], 1).version).toBe(TEAM_V2);
    for (const [move, want] of [["guard", 5], ["dodge", 4]] as const) {
      expect(rate(want), move).toBeGreaterThan(0.25);
      expect(rate(want), move).toBeLessThan(0.75);
    }
  });
});

