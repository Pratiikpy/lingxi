import { describe, expect, it } from "vitest";
import { type PublicClient, createPublicClient, http } from "viem";
import { readFileSync } from "node:fs";
import { checkPartner } from "../src/breeding";
import type { Deployment } from "../src/registry";

const OWNER = "0x1111111111111111111111111111111111111111";
const d = { registry: "0x103d000000000000000000000000000000005e99" } as unknown as Deployment;
const pub = (owner: string, brainId: bigint, fail = false) =>
  ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (fail) throw new Error("rpc down");
      if (functionName === "ownerOf") return owner;
      return {
        processor: "0x0",
        brainId,
        line: 0,
        brainBits: 8,
        day: 3,
        born: 1,
        checkedAt: 1,
        logHash: "0x",
        state: 0n,
        parentA: 0n,
        parentB: 0n,
      };
    },
  }) as unknown as PublicClient;

describe("a family partner, checked on X Layer before anything is signed or spent", () => {
  it("passes only when the address owns the pet and the pet's brain is the one named", async () => {
    expect(
      await checkPartner(pub(OWNER, 42n), d, {
        petId: "7",
        owner: OWNER.toUpperCase().replace("0X", "0x"),
        brain: "42",
      }),
    ).toBe("ok");
    // someone names their own wallet beside a pet that is not theirs, to be given consent for it
    expect(
      await checkPartner(pub(OWNER, 42n), d, {
        petId: "7",
        owner: "0x2222222222222222222222222222222222222222",
        brain: "42",
      }),
    ).toBe("notOwner");
    expect(await checkPartner(pub(OWNER, 42n), d, { petId: "7", owner: OWNER, brain: "43" })).toBe("notBrain");
    expect(await checkPartner(pub(OWNER, 42n, true), d, { petId: "7", owner: OWNER, brain: "42" })).toBe("unreadable");
    expect(await checkPartner(pub(OWNER, 42n), d, { petId: "-1", owner: OWNER, brain: "42" })).toBe("notOwner");
  });

  it("on X Layer itself: pet #1 with its real owner and brain passes, with another owner it does not", async () => {
    const live = createPublicClient({ transport: http("https://xlayerrpc.okx.com") }) as PublicClient;
    const xl = JSON.parse(readFileSync(new URL("../deployments/xlayer.json", import.meta.url), "utf8")) as Deployment;
    const { readPet } = await import("../src/registry");
    const one = await readPet(live, xl, 1n);
    expect(await checkPartner(live, xl, { petId: "1", owner: one.owner, brain: one.brainId.toString() })).toBe("ok");
    expect(await checkPartner(live, xl, { petId: "1", owner: OWNER, brain: one.brainId.toString() })).toBe("notOwner");
  });
});
