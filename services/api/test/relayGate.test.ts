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
  const caps = { perPetPerDay: 3, perSignerPerDay: 5, perHour: 6 };

  it("caps tape-outs per pet and per signer each day, and everyone each hour", () => {
    const q = new RelayQuota(caps);
    const t = NOW;
    for (let i = 0; i < 3; i++) expect(q.take("7", "0xa", true, t).ok).toBe(true);
    expect(q.take("7", "0xa", true, t)).toEqual({ ok: false, reason: "busy" });
    for (let i = 0; i < 2; i++) expect(q.take(`p${i}`, "0xa", true, t).ok).toBe(true);
    expect(q.take("p9", "0xa", true, t)).toEqual({ ok: false, reason: "busy" });
    expect(q.take("p9", "0xb", true, t).ok).toBe(true);
    expect(q.take("p10", "0xc", true, t)).toEqual({ ok: false, reason: "busy" });
    expect(q.take("p10", "0xc", true, t + 3_600_001).ok).toBe(true);
    expect(q.take("7", "0xa", true, t + 86_400_001).ok).toBe(true);
  });

  it("gives the slot back for a brain that was already taped out", () => {
    const q = new RelayQuota({ perPetPerDay: 1, perSignerPerDay: 1, perHour: 1 });
    const a = q.take("7", "0xa", true, NOW);
    expect(a.ok).toBe(true);
    if (a.ok) q.refund(a.ticket);
    expect(q.take("7", "0xa", true, NOW).ok).toBe(true);
  });
});

describe("sponsored tape-outs go first to pets with standing, and cannot be raced (A40)", () => {
  it("takes the slot before the work: a burst of requests never passes a cap", () => {
    const q = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 12, perHour: 12 });
    // twenty asks land together, before any tape-out has finished
    const passed = Array.from({ length: 20 }, () => q.take("7", "0xa", true, NOW)).filter((r) => r.ok);
    expect(passed).toHaveLength(6);
  });

  it("lets pets not yet settled draw only the newcomers' share of the hour and of the day", () => {
    const q = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 100, perHour: 12, perDay: 100, newcomerShare: 0.25, lifetime: { newcomer: 3, settled: 40 } });
    // a quarter of the hour: three newcomer tape-outs, from three fresh pets and keys
    for (let i = 0; i < 3; i++) expect(q.take(`n${i}`, `0xn${i}`, false, NOW).ok).toBe(true);
    expect(q.take("n9", "0xn9", false, NOW)).toEqual({ ok: false, reason: "newcomer" });
    // settled pets still have the rest of the hour
    for (let i = 0; i < 9; i++) expect(q.take(`s${i}`, `0xs${i}`, true, NOW).ok).toBe(true);
    expect(q.take("s9", "0xs9", true, NOW)).toEqual({ ok: false, reason: "busy" });
    // over a day, newcomers stop at a quarter of the relayer's 100
    const day = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 100, perHour: 1000, perDay: 100, newcomerShare: 0.25, lifetime: { newcomer: 3, settled: 40 } });
    let fresh = 0;
    for (let i = 0; i < 40; i++) if (day.take(`f${i}`, `0xf${i}`, false, NOW + i * 60_000).ok) fresh++;
    expect(fresh).toBe(25);
  });

  it("sponsors a pet 3 tape-outs before it settles and 40 in its life", () => {
    const q = new RelayQuota({ perPetPerDay: 1000, perSignerPerDay: 1000, perHour: 1000, perDay: 1000, newcomerShare: 1, lifetime: { newcomer: 3, settled: 40 } });
    for (let i = 0; i < 3; i++) expect(q.take("7", "0xa", false, NOW + i).ok).toBe(true);
    expect(q.take("7", "0xa", false, NOW)).toEqual({ ok: false, reason: "lifetime" });
    // once settled, the same pet goes on to 40 in all
    let more = 0;
    for (let i = 0; i < 50; i++) if (q.take("7", "0xa", true, NOW + 100 + i).ok) more++;
    expect(more).toBe(37);
    expect(q.take("7", "0xa", true, NOW + 1000)).toEqual({ ok: false, reason: "lifetime" });
  });

  it("keeps each pet's lifetime count on disk, so a restart does not hand them out again", () => {
    const file = join(mkdtempSync(join(tmpdir(), "lx-quota-")), "relay-quota.json");
    const caps = { perPetPerDay: 1000, perSignerPerDay: 1000, perHour: 1000, perDay: 1000, newcomerShare: 1, lifetime: { newcomer: 3, settled: 40 } };
    const a = new RelayQuota(caps, file);
    for (let i = 0; i < 3; i++) a.take("7", "0xa", false, NOW);
    expect(new RelayQuota(caps, file).take("7", "0xa", false, NOW)).toEqual({ ok: false, reason: "lifetime" });
    // a slot given back is not counted
    const b = new RelayQuota(caps, file);
    const t = b.take("8", "0xa", false, NOW);
    if (t.ok) b.refund(t.ticket);
    expect(new RelayQuota(caps, file).take("8", "0xa", false, NOW).ok).toBe(true);
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

  it("refuses a tape-out whose transistor fee its BEM cannot pay, before anything is sent (A40)", async () => {
    const relayer = relayerWith({ reserveWei: 0n });
    vi.spyOn(relayer, "balance").mockResolvedValue(OKB);
    // this processor takes its 0.01 BEM fee in BEM, once per kind of transistor minted (mainnet, 2026-11-20)
    vi.spyOn(relayer, "mintCalls").mockResolvedValue(2);
    vi.spyOn(relayer, "fees").mockResolvedValue({ bem: 1_500_000n, protocolFee: 1_000_000n, feeIn: "bem" });
    expect(await relayer.relay("gentle", [])).toMatchObject({ ok: false, reason: "budget", detail: "the relayer's BEM is too low for the transistor fee" });
    expect(relayer.usage().today, "nothing counted, nothing sent").toBe(0);
  });
});


describe("a request is charged for every tape-out it can send (A75)", () => {
  it("takes several slots at once against every cap, and gives back those not used", () => {
    const q = new RelayQuota({ perPetPerDay: 6, perSignerPerDay: 100, perHour: 12, perDay: 100, newcomerShare: 0.25, lifetime: { newcomer: 3, settled: 40 } });
    const a = q.take("7", "0xA", false, 0, 3);
    expect(a.ok, "three slots for a child's halves and glue").toBe(true);
    expect(q.take("8", "0xB", false, 0, 1), "the hour's newcomer share (3 of 12) is used by that one request").toEqual({ ok: false, reason: "newcomer" });
    // two of the three were not sent (halves already taped out): they come back
    if (a.ok) q.refund(a.ticket, 2);
    expect(q.take("8", "0xB", false, 0, 1).ok).toBe(true);
    expect(q.take("7", "0xA", true, 0, 6), "a pet's day is six, and one is used").toEqual({ ok: false, reason: "busy" });
    expect(q.take("9", "0xC", false, 0, 4), "more than a newcomer pet's lifetime at once").toEqual({ ok: false, reason: "lifetime" });
  });
});
