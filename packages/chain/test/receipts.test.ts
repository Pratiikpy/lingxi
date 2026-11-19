import { describe, expect, it } from "vitest";
import { type Address, type Hex, type TransactionReceipt, createPublicClient, encodeAbiParameters, encodeEventTopics, http, parseAbi } from "viem";
import { circuitIdFrom, hatchedPetIdFrom, RevertedOnChain } from "../src/receipts";
import { petRegistryAbi } from "../src/registryAbi";

const PROC = "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e" as Address;
const REG = "0x103d7252eb6b2fec22b3f65a6bb605945f280e99" as Address;
const ME = "0x20A016fbeAf847C47eC32d7e759365a51a8385A1" as Address;
const OTHER = "0x000000000000000000000000000000000000bEEF" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const transfer = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
const mint = (at: Address, from: Address, to: Address, id: bigint) => ({ address: at, data: "0x" as Hex, topics: encodeEventTopics({ abi: transfer, eventName: "Transfer", args: { from, to, tokenId: id } }) as Hex[] });
const hatch = (at: Address, petId: bigint, to: Address) => ({
  address: at,
  topics: encodeEventTopics({ abi: petRegistryAbi, eventName: "Hatched", args: { petId, to } }) as Hex[],
  data: encodeAbiParameters([{ type: "uint8" }, { type: "address" }, { type: "uint64" }, { type: "uint256" }], [0, PROC, 1n, 0n]),
});
const receipt = (logs: Array<{ address: Address; topics: Hex[]; data: Hex }>, status: "success" | "reverted" = "success") => ({ status, logs }) as unknown as TransactionReceipt;

describe("ids read from what was mined, never from a simulation", () => {
  it("a tape-out's circuit is the token the processor minted to us", () => {
    expect(circuitIdFrom(receipt([mint(PROC, ZERO, ME, 42n)]), PROC, ME)).toBe(42n);
  });

  it("refuses a mint by another contract, to someone else, a transfer that is not a mint, or a reverted transaction", () => {
    expect(() => circuitIdFrom(receipt([mint(OTHER, ZERO, ME, 42n)]), PROC, ME)).toThrow(/no circuit/);
    expect(() => circuitIdFrom(receipt([mint(PROC, ZERO, OTHER, 42n)]), PROC, ME)).toThrow(/no circuit/);
    expect(() => circuitIdFrom(receipt([mint(PROC, OTHER, ME, 42n)]), PROC, ME)).toThrow(/no circuit/);
    // mined and turned down: the typed error, so a screen can say its fee was spent (A22)
    expect(() => circuitIdFrom(receipt([mint(PROC, ZERO, ME, 42n)], "reverted"), PROC, ME)).toThrow(RevertedOnChain);
  });

  it("refuses a receipt that minted two circuits rather than guess which", () => {
    expect(() => circuitIdFrom(receipt([mint(PROC, ZERO, ME, 42n), mint(PROC, ZERO, ME, 43n)]), PROC, ME)).toThrow(/more than one/);
  });

  it("a hatch's pet is the one the registry says hatched, for us", () => {
    expect(hatchedPetIdFrom(receipt([hatch(REG, 9n, ME)]), REG, ME)).toBe(9n);
    expect(() => hatchedPetIdFrom(receipt([hatch(REG, 9n, OTHER)]), REG, ME)).toThrow(/no pet/);
    expect(() => hatchedPetIdFrom(receipt([hatch(OTHER, 9n, ME)]), REG, ME)).toThrow(/no pet/);
  });
});

describe.skipIf(!process.env.LIVE_XLAYER)("a real tape-out on X Layer mainnet", () => {
  it("names circuit 10, as recorded", async () => {
    const pub = createPublicClient({ transport: http("https://xlayerrpc.okx.com") });
    const rc = await pub.getTransactionReceipt({ hash: "0x7096ffa48ef0b968785bfe5f4faeba517a3d65919b15de26b87e82950af48471" });
    expect(circuitIdFrom(rc, PROC, "0xA551feD6f2Ab35d509A71B74D5E9F38742E0aaD8")).toBe(10n);
  }, 30_000);
});
