import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signRelay } from "@lingxi/chain";
import { RelayQuota, checkRelayAuth, createNonceBook } from "../src/relayGate";
import { BrainRelayer } from "../src/relayer";

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const NOW = 1_800_000_000_000;
const keeps = (pet: string, who: string) => Promise.resolve(pet === "7" && who.toLowerCase() === owner.address.toLowerCase());
const deps = () => ({ isKeeper: keeps, now: () => NOW, nonces: createNonceBook() });
const body = { line: "gentle", lessons: [] };

describe("who may ask the relayer to tape out a brain", () => {
  it("the pet's keeper, with a fresh signature over this exact request", async () => {
    const req = await signRelay(owner, "brain", "7", body, NOW);
    expect(await checkRelayAuth(req, deps())).toEqual({ ok: true, signer: owner.address });
  });

  it("not anyone else, and not for another pet", async () => {
    expect(await checkRelayAuth(await signRelay(stranger, "brain", "7", body, NOW), deps())).toMatchObject({ ok: false, reason: "notKeeper" });
    expect(await checkRelayAuth(await signRelay(owner, "brain", "8", body, NOW), deps())).toMatchObject({ ok: false, reason: "notKeeper" });
  });

  it("not a signature moved onto another request, another kind, or another pet number", async () => {
    const req = await signRelay(owner, "brain", "7", body, NOW);
    expect(await checkRelayAuth({ ...req, payload: JSON.stringify({ ...body, lessons: [1] }) }, deps())).toMatchObject({ ok: false, reason: "badSignature" });
    expect(await checkRelayAuth({ ...req, kind: "child" }, deps())).toMatchObject({ ok: false, reason: "badSignature" });
    expect(await checkRelayAuth({ ...req, auth: { ...req.auth, signer: stranger.address } }, deps())).toMatchObject({ ok: false, reason: "badSignature" });
  });

  it("not the same signature twice", async () => {
    const d = deps();
    const req = await signRelay(owner, "brain", "7", body, NOW);
    expect(await checkRelayAuth(req, d)).toMatchObject({ ok: true });
    expect(await checkRelayAuth(req, d)).toMatchObject({ ok: false, reason: "replayed" });
  });

  it("not a signature older or newer than five minutes", async () => {
    expect(await checkRelayAuth(await signRelay(owner, "brain", "7", body, NOW - 6 * 60_000), deps())).toMatchObject({ ok: false, reason: "expired" });
    expect(await checkRelayAuth(await signRelay(owner, "brain", "7", body, NOW + 6 * 60_000), deps())).toMatchObject({ ok: false, reason: "expired" });
  });

  it("not an unsigned or malformed request", async () => {
    const req = await signRelay(owner, "brain", "7", body, NOW);
    expect(await checkRelayAuth({ ...req, auth: { ...req.auth, signature: "0x1234" } }, deps())).toMatchObject({ ok: false });
    expect(await checkRelayAuth({ ...req, petId: "seven" }, deps())).toMatchObject({ ok: false, reason: "unsigned" });
  });

  it("the audit's drain: 37 unsigned requests reach no tape-out", async () => {
    let reached = 0;
    for (let i = 0; i < 37; i++) {
      const req = { kind: "brain" as const, petId: "7", payload: JSON.stringify({ ...body, i }), auth: { signer: stranger.address, nonce: `n${i}`, time: NOW / 1000, signature: "0x" as const } };
      if ((await checkRelayAuth(req, deps())).ok) reached++;
    }
    expect(reached).toBe(0);
  });
});

describe("how much one pet, one keeper and everyone together may ask for", () => {
  it("caps tape-outs per pet and per signer each day, and everyone each hour", () => {
    const q = new RelayQuota({ perPetPerDay: 3, perSignerPerDay: 5, perHour: 6 });
    const t = NOW;
    for (let i = 0; i < 3; i++) {
      expect(q.allow("7", "0xa", t)).toBe(true);
      q.spend("7", "0xa", t);
    }
    expect(q.allow("7", "0xa", t)).toBe(false);
    for (let i = 0; i < 2; i++) {
      expect(q.allow(`p${i}`, "0xa", t)).toBe(true);
      q.spend(`p${i}`, "0xa", t);
    }
    expect(q.allow("p9", "0xa", t)).toBe(false);
    expect(q.allow("p9", "0xb", t)).toBe(true);
    q.spend("p9", "0xb", t);
    expect(q.allow("p10", "0xc", t)).toBe(false);
    expect(q.allow("p10", "0xc", t + 3_600_001)).toBe(true);
    expect(q.allow("7", "0xa", t + 86_400_001)).toBe(true);
  });

  it("charges nothing for a brain that was already taped out", () => {
    const q = new RelayQuota({ perPetPerDay: 1, perSignerPerDay: 1, perHour: 1 });
    expect(q.allow("7", "0xa", NOW)).toBe(true);
    expect(q.allow("7", "0xa", NOW)).toBe(true);
  });
});

describe("what the relayer itself holds back", () => {
  /** A relayer on a node that never answers: anything it tries to send fails, so a refusal here came before sending. */
  const relayerWith = (cfg: { maxPerHour?: number; reserveWei?: bigint }, store?: unknown) => {
    const file = join(mkdtempSync(join(tmpdir(), "lx-")), "brains.json");
    if (store) writeFileSync(file, JSON.stringify(store));
    return new BrainRelayer({ rpc: "http://127.0.0.1:9", processor: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e", key: generatePrivateKey(), storeFile: file, maxPerDay: 100, ...cfg });
  };
  const OKB = 10n ** 18n;

  it("refuses a player's tape-out that would reach into the OKB kept for season keepsakes", async () => {
    const relayer = relayerWith({ reserveWei: OKB / 100n });
    // 0.012 OKB held: a tape-out set aside at 0.004 would leave less than the 0.01 reserve
    vi.spyOn(relayer, "balance").mockResolvedValue((OKB * 12n) / 1000n);
    expect(await relayer.relay("gentle", [])).toMatchObject({ ok: false, reason: "budget", detail: "the relayer's OKB is held for season keepsakes" });
    expect(relayer.usage().today).toBe(0);
  });

  it("refuses a tape-out once this hour's are used, before anything is sent", async () => {
    const now = Date.now();
    const relayer = relayerWith({ maxPerHour: 2, reserveWei: 0n }, { brains: {}, day: new Date(now).toISOString().slice(0, 10), used: 2, hour: [now - 60_000, now - 120_000] });
    const balance = vi.spyOn(relayer, "balance").mockResolvedValue(OKB);
    expect(await relayer.relay("gentle", [])).toMatchObject({ ok: false, reason: "budget", detail: "this hour's tape-outs are used" });
    expect(balance).not.toHaveBeenCalled();
    expect(relayer.usage(now)).toMatchObject({ today: 2, lastHour: 2 });
  });
});
