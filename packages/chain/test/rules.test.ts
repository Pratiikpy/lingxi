import { describe, expect, it } from "vitest";
import { N_IN, type RuleCircuit, fastBrain, ruleNetlist, ruleTable } from "@lingxi/brain";
import { TIER_GATE, tierNeed, tierOpenFor } from "@lingxi/game";
import {
  DROP_RULE,
  FOLK,
  TRUST_RULE,
  familiarStep,
  folkAnswer,
  giftTrust,
  isRareTier,
  tierWeight,
  trustLevelOf,
} from "@lingxi/world";
import type { Address, PublicClient } from "viem";
import { RULES, checkRules, ruleHex, rulesVerdict } from "../src/rules";

const PROCESSOR = "0x0000000000000000000000000000000000000001" as Address;

/** A stand-in for X Layer that holds the given netlists by circuit id. */
const chainHolding = (stored: Record<string, string>, failing = false) =>
  ({
    readContract: async ({ args }: { args: [bigint] }) => {
      if (failing) throw new Error("offline");
      const hex = stored[String(args[0])];
      if (hex === undefined) throw new Error("no circuit");
      return hex;
    },
  }) as unknown as PublicClient;

const recordsFor = (rules: readonly RuleCircuit[]) =>
  Object.fromEntries(rules.map((r, i) => [r.name, { id: String(100 + i), tx: "0x", gates: 0 }]));
const storedFor = (rules: readonly RuleCircuit[]) =>
  Object.fromEntries(rules.map((r, i) => [String(100 + i), ruleHex(r)]));

describe("every rule circuit (plan 4.11)", () => {
  it("lists the drop, trust and skill rules, a circuit for each of the nine residents and each of the five builder pets", () => {
    expect(RULES.map((r) => r.name)).toEqual([
      "drop",
      "trust",
      "skills",
      ...FOLK.map((f) => `folk:${f.id}`),
      "builder:behemoth",
      "builder:mars",
      "builder:tapboy",
      "builder:builder",
      "builder:diver",
    ]);
    expect(new Set(RULES.map((r) => r.name)).size).toBe(RULES.length);
  });

  it.each(RULES.map((r) => [r.name, r] as const))(
    "%s: the circuit answers like its rule on all 65,536 input words",
    (_name, rule) => {
      const brain = fastBrain(ruleNetlist(rule));
      const none = new Uint8Array(0);
      const mask = (1 << rule.inBits) - 1;
      for (let w = 0; w < 1 << N_IN; w++) {
        const got = brain.step(none, w) & 0xff;
        const want = rule.reference(w & mask);
        if (got !== want) throw new Error(`${rule.name}: input ${w} gives ${got}, the rule says ${want}`);
      }
      // the table the game reads is the circuit's
      const table = ruleTable(rule);
      for (let w = 0; w <= mask; w++) expect(table[w]).toBe(rule.reference(w));
    },
  );

  it("each resident and builder pet has its own circuit (no two netlists alike)", () => {
    expect(new Set(RULES.map(ruleHex)).size).toBe(RULES.length);
  });

  it("is small: under 2,500 gates for all seventeen together", () => {
    const gates = RULES.reduce((n, r) => n + ruleNetlist(r).gates.length, 0);
    expect(gates).toBeLessThan(2500);
  });
});

describe("the game reads its rules from the circuits", () => {
  it("drops: a tier weighs 2^(tier-1), tiers 1-4 are rare, a matching room adds 2 familiarity", () => {
    expect([0, 1, 2, 4, 5, 9, 11].map(tierWeight)).toEqual([0, 1, 2, 8, 16, 256, 1024]);
    expect([0, 1, 4, 5].map(isRareTier)).toEqual([false, true, true, false]);
    expect([familiarStep(false), familiarStep(true)]).toEqual([1, 2]);
    expect(DROP_RULE.inBits).toBe(5);
  });

  it("trust: levels at 0, 5, 15, 30, 50, 80; a first gift adds 4, 2 or 1; a second adds none; a disliked one is refused", () => {
    expect([0, 4, 5, 14, 15, 29, 30, 49, 50, 79, 80, 127, 400].map(trustLevelOf)).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5,
    ]);
    expect(giftTrust("love", false)).toEqual({ points: 4, refused: false });
    expect(giftTrust("like", false).points).toBe(2);
    expect(giftTrust("neutral", false).points).toBe(1);
    expect(giftTrust("love", true).points).toBe(0);
    expect(giftTrust("dislike", false)).toEqual({ points: 0, refused: true });
    expect(TRUST_RULE.inBits).toBe(10);
  });

  it("skills: each tier opens at its gate and no sooner; a missing tier never opens", () => {
    for (let tier = 1; tier <= 6; tier++) {
      expect(tierNeed(tier)).toBe(TIER_GATE[tier - 1]);
      expect(tierOpenFor(TIER_GATE[tier - 1]!, tier)).toBe(true);
      if (TIER_GATE[tier - 1]! > 0) expect(tierOpenFor(TIER_GATE[tier - 1]! - 1, tier)).toBe(false);
    }
    expect([tierOpenFor(63, 0), tierOpenFor(63, 7)]).toEqual([false, false]);
  });

  it("residents: an errand ready beats everything; a refused gift and a loved one change the line and the mood", () => {
    const word = (o: {
      tod?: number;
      trust?: number;
      gift?: number;
      happy?: boolean;
      hungry?: boolean;
      ready?: boolean;
    }) =>
      (o.tod ?? 2) |
      ((o.trust ?? 0) << 2) |
      ((o.gift ?? 0) << 5) |
      (o.happy ? 128 : 0) |
      (o.hungry ? 256 : 0) |
      (o.ready ? 512 : 0);
    for (const f of FOLK) {
      expect(folkAnswer(f.id, word({}))!.slot, f.id).toBe(0);
      expect(folkAnswer(f.id, word({ ready: true, gift: 3, hungry: true }))!.slot, f.id).toBe(f.order[0]);
      const loved = folkAnswer(f.id, word({ gift: 1 }))!;
      const refused = folkAnswer(f.id, word({ gift: 3 }))!;
      expect(loved.mood, f.id).toBeGreaterThan(refused.mood);
    }
    // Why the nurse puts a hungry pet first, even before an errand
    expect(folkAnswer("why", word({ hungry: true, ready: true }))!.slot).toBe(6);
  });
});

describe("the start-up check (plan 4.11)", () => {
  it("passes when every rule matches its circuit on chain", async () => {
    const checks = await checkRules(chainHolding(storedFor(RULES)), PROCESSOR, recordsFor(RULES));
    expect(checks.every((c) => c.status === "match")).toBe(true);
    expect(rulesVerdict(checks)).toBe("verified");
  });

  it("fails when one local rule is changed, naming it, and only it", async () => {
    // the trust ladder moved by one point here, while the chain still holds the taped-out rule
    const changed: RuleCircuit = {
      ...TRUST_RULE,
      name: "trust",
      reference: (w) => TRUST_RULE.reference(Math.min(127, (w & 127) + 1) | (w & ~127)),
    };
    const local = RULES.map((r) => (r.name === "trust" ? changed : r));
    const checks = await checkRules(chainHolding(storedFor(RULES)), PROCESSOR, recordsFor(RULES), local);
    expect(checks.filter((c) => c.status !== "match").map((c) => [c.name, c.status])).toEqual([["trust", "differs"]]);
    expect(rulesVerdict(checks)).toBe("broken");
  });

  it("fails when a rule has no circuit on record, and says unknown when X Layer cannot be read", async () => {
    const records = recordsFor(RULES);
    delete records["folk:bolt"];
    const missing = await checkRules(chainHolding(storedFor(RULES)), PROCESSOR, records);
    expect(missing.find((c) => c.name === "folk:bolt")?.status).toBe("missing");
    expect(rulesVerdict(missing)).toBe("broken");
    const offline = await checkRules(chainHolding({}, true), PROCESSOR, recordsFor(RULES));
    expect(rulesVerdict(offline)).toBe("unknown");
  });
});
