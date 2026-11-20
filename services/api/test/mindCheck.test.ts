/** A62: season proofs compare minds off the request thread, with a budget and a queue. */
import { describe, expect, it } from "vitest";
import { STARTERS, compileProgram, load, netlistBytes } from "@lingxi/brain";
import { petCard, parseCard } from "@lingxi/game";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signRelay } from "@lingxi/chain";
import { createMindChecker } from "../src/mindCheck";
import { proveSeasonEntry } from "../src/seasonProof";
import { createNonceBook } from "../src/relayGate";

const gentle = load(netlistBytes(compileProgram(STARTERS.gentle)), 16, 8);
const card = (lessons: unknown[]) => parseCard(petCard({ line: "gentle", lessons, instincts: 0 } as never))!;
const lesson = { when: { hunger: [3] }, then: { want: 5, mood: 2 } };

describe("the mind check, in a worker (A62)", () => {
  it("says a mind is the circuit on chain, or is not, from a worker thread", async () => {
    const check = createMindChecker();
    expect(await check(gentle, "gentle", card([]))).toBe("same");
    expect(await check(gentle, "gentle", card([lesson]))).toBe("different");
  }, 60_000);

  it("a check past its budget is slow, never a mismatch", async () => {
    expect(await createMindChecker({ budgetMs: 1 })(gentle, "gentle", card([]))).toBe("slow");
  }, 60_000);

  it("a few run at once, a few wait, and past that a check is busy", async () => {
    const release: Array<() => void> = [];
    const run = () => new Promise<"same">((r) => release.push(() => r("same")));
    const check = createMindChecker({ atOnce: 1, waiting: 1, run });
    const first = check(gentle, "gentle", card([]));
    const second = check(gentle, "gentle", card([]));
    expect(await check(gentle, "gentle", card([]))).toBe("busy");
    release.shift()!();
    expect(await first).toBe("same");
    await new Promise((r) => setTimeout(r, 0));
    release.shift()!();
    expect(await second).toBe("same");
  });

  it("a proof the checker cannot take now is refused as busy, so the player tries again", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const pet = { name: "Sora", line: "gentle", stage: "adult", card: petCard({ line: "gentle", lessons: [], instincts: 0 } as never), story: { days: 3, lessons: 0, nature: [] } };
    const r = await proveSeasonEntry(pet, await signRelay(owner, "season", "7", pet), {
      isKeeper: async () => true,
      brainOf: async () => {
        throw new Error("not used");
      },
      now: () => Date.now(),
      nonces: createNonceBook(),
      circuitOf: async () => gentle,
      check: async () => "busy",
    });
    expect(r).toEqual({ ok: false, reason: "busy" });
  });
});
