/**
 * G2 item 7: the replay explains itself. The other side's rule comes from a mind built the way its brain was, so its
 * rewind agrees with every move it made; the exchanges are read from the round.
 */
import { describe, expect, it } from "vitest";
import { STARTERS } from "@lingxi/brain";
import { fighterFrom, fighterOfPartner } from "../src/coach";
import { duel, type Challenge, type DuelPet } from "../src/duel";
import { petCard } from "../src/family";
import { duelPetMind, exchangesOf, partnerMind } from "../src/fightWhy";
import { PARTNERS } from "../src/partners";
import { rewindFight } from "../src/replay";
import { MOVES, SPAR_VERSION, spar } from "../src/spar";
import { SPAR_V2, allowedMove, spar2 } from "../src/spar2";
import { composeProgram } from "../src/lessons";
import type { SparResult } from "../src/spar";

/** every move side 1 made is what its rewound rule wanted, after the stamina rule and a pounce's slip */
function agrees(result: SparResult, wants: number[], startStamina = 10) {
  result.rounds.forEach((r, k) => {
    const stamina = k === 0 ? startStamina : result.rounds[k - 1]!.stamina[1];
    const allowed = allowedMove(result.version, wants[k]!, stamina);
    expect(r.moves[1] === allowed || (allowed === "pounce" && r.moves[1] === "tap"), `round ${k + 1}: made ${r.moves[1]}, wanted ${MOVES[wants[k]! & 7]}`).toBe(true);
  });
}

describe("the other side's rule (G2)", () => {
  it("a sparring partner's rewound rule agrees with every move it made", () => {
    for (const p of PARTNERS) {
      const result = spar2(fighterFrom("me", STARTERS.bold, 1), fighterOfPartner(p), 1009);
      const why = rewindFight(partnerMind(p)!, [], result.rounds.map((r) => r.words[1]));
      // the rewind gives the want; its mood rides along for the excited cost
      const wants = why.map((w, k) => w.want | (result.rounds[k]!.moods[1] << 3));
      agrees(result, wants);
    }
  });

  it("a duel challenger's rewound rule agrees with every move it made", () => {
    const pet = (name: string, line: DuelPet["line"]): DuelPet => ({ name, line, stage: "adult", card: petCard({ lessons: [{ when: { action: [2] }, then: { want: 5, mood: 1 } }] as never, instincts: 1 }), story: { days: 3, lessons: 1, nature: [] } });
    const challenge: Challenge = { id: "whyduel01", from: pet("Mochi", "gentle"), at: 1 };
    const result = duel(challenge, pet("Rex", "bold"));
    const m = duelPetMind(challenge.from)!;
    const why = rewindFight(m.mind, m.memory ?? [], result.rounds.map((r) => r.words[1]));
    agrees(result, why.map((w, k) => w.want | (result.rounds[k]!.moods[1] << 3)));
  });

  it("a fruit fly or Behemoth has no pet mind to rewind", () => {
    expect(partnerMind({ ...PARTNERS[0]!, look: "fly" })).toBeNull();
  });
});

describe("what the fight's rules did (G2)", () => {
  const only = (want: string) => fighterFrom(want, { ...composeProgram("gentle", []), rules: [], otherwise: { want: MOVES.indexOf(want as never), mood: 1 } }, 1);

  it("reads a guarded pounce, a clean dodge, a punished rest and a feint from the rounds", () => {
    const g = spar2(only("pounce"), only("guard"), 5);
    expect(exchangesOf(SPAR_V2, g.rounds, 0)).toEqual([{ kind: "guarded", by: 1, back: g.rounds[0]!.hits[1], timed: true }]);
    expect(exchangesOf(SPAR_V2, g.rounds, 1)[0]).toMatchObject({ kind: "guarded", timed: false });
    const r = spar2(only("pounce"), only("rest"), 5);
    expect(exchangesOf(SPAR_V2, r.rounds, 0)).toEqual([{ kind: "punished", by: 0, open: "rest" }]);
    const f = spar2(only("charm"), only("guard"), 5);
    expect(exchangesOf(SPAR_V2, f.rounds, 0)).toEqual([{ kind: "feint", by: 0, hit: f.rounds[0]!.hits[0] }]);
    const seen = new Set<string>();
    for (let s = 1; s < 40; s++) {
      const d = spar2(only("pounce"), only("dodge"), s);
      for (const e of exchangesOf(SPAR_V2, d.rounds, 0)) seen.add(e.kind);
    }
    expect([...seen].sort()).toEqual(["caught", "dodged"]);
  });

  it("shows nothing for a spar fought in LX-SPAR/1, whose rules were different", () => {
    const old = spar(only("pounce"), only("guard"), 5);
    expect(old.version).toBe(SPAR_VERSION);
    expect(exchangesOf(SPAR_VERSION, old.rounds, 0)).toEqual([]);
  });
});
