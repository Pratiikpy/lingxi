import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signRelay } from "@lingxi/chain";
import { STARTERS } from "@lingxi/brain";
import { mindBrain, petCard } from "@lingxi/game";
import { createNonceBook } from "../src/relayGate";
import { proveSeasonEntry, sameBrain } from "../src/seasonProof";

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const lesson = { when: { hunger: [3] }, then: { want: 5, mood: 2 } };
const entry = (lessons: unknown[] = [lesson]) => ({ name: "Sora", line: "gentle", stage: "adult", card: petCard({ line: "gentle", lessons, instincts: 0 } as never), story: { days: 3, lessons: lessons.length, nature: [] } });
const onChainBrain = mindBrain({ line: "gentle", lessons: [lesson as never] });

const deps = (chainBrain = onChainBrain) => ({
  isKeeper: async (pet: string, who: string) => pet === "7" && who.toLowerCase() === owner.address.toLowerCase(),
  brainOf: async () => chainBrain,
  now: () => Date.now(),
  nonces: createNonceBook(),
});

describe("an entry proven to be a pet on X Layer", () => {
  it("is signed by its keeper over this exact entry, and thinks exactly as its brain on chain", async () => {
    const e = entry();
    expect(await proveSeasonEntry(e, await signRelay(owner, "season", "7", e), deps())).toEqual({ ok: true, petId: "7" });
  });

  it("is not a stranger's, not another entry's signature, and not a card that thinks differently from the chain", async () => {
    const e = entry();
    expect(await proveSeasonEntry(e, await signRelay(stranger, "season", "7", e), deps())).toMatchObject({ ok: false, reason: "notKeeper" });
    expect(await proveSeasonEntry(entry([]), await signRelay(owner, "season", "7", e), deps())).toMatchObject({ ok: false, reason: "notThisEntry" });
    const other = entry([{ when: { joy: [3] }, then: { want: 2, mood: 3 } }]);
    expect(await proveSeasonEntry(other, await signRelay(owner, "season", "7", other), deps())).toMatchObject({ ok: false, reason: "notItsBrain" });
    expect(await proveSeasonEntry(e, await signRelay(owner, "brain", "7", e), deps())).toMatchObject({ ok: false, reason: "notThisEntry" });
  });
});

describe("two brains are the same mind", () => {
  it("when every input gives the same answer and memory, from empty memory and from the card's", () => {
    const a = mindBrain({ line: "gentle", lessons: [] });
    expect(sameBrain(a, mindBrain({ line: "gentle", lessons: [] }))).toBe(true);
    expect(sameBrain(a, mindBrain({ line: "bold", lessons: [] }))).toBe(false);
    expect(STARTERS.gentle).toBeTruthy();
  });
});
