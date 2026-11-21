/**
 * H4: who may have a pet kept on X Layer for them, before anything is sent. Every refusal is free: no slot is held
 * after it, and nothing reaches the relayer.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signSponsorRequest } from "@lingxi/chain";
import { SponsorGate } from "../src/sponsor";

const NOW = 1_800_000_000_000;
/** a starting state whose line bits (152-153) say `line` */
const stateOf = (line: number) => ((BigInt(line) << 152n) | 0x1234n).toString();
const file = () => join(mkdtempSync(join(tmpdir(), "lx-sponsor-")), "sponsored.json");
const gate = (o: Partial<ConstructorParameters<typeof SponsorGate>[0]> = {}) => new SponsorGate({ file: file(), enabled: true, now: () => NOW, ...o });
const asked = async (line: "gentle" | "bold" | "curious" = "gentle", at = NOW, key = privateKeyToAccount(generatePrivateKey())) => {
  const { request, signature } = await signSponsorRequest(key, { line, state: stateOf(["gentle", "bold", "curious"].indexOf(line)), at });
  return { ...request, signature, key };
};

describe("who may have a pet kept for them (H4)", () => {
  it("lets a fresh device key through once, and holds its slot until the outcome is written", async () => {
    const g = gate();
    const body = await asked();
    const r = await g.check(body, "203.0.113.5");
    expect(r).toMatchObject({ ok: true, retryGrant: false });
    if (!r.ok) return;
    // a second request for the same key while the first is out is refused, not sent twice
    expect(await g.check(body, "203.0.113.5")).toMatchObject({ ok: false, reason: "busy" });
    g.finish(r.slot, { petId: "9", hatchTx: "0x1", grantTx: "0x2" });
    // and once it has its pet, never again
    expect(await g.check({ ...(await asked()), ...{} }, "203.0.113.6")).toMatchObject({ ok: true });
    expect(await g.check(body, "203.0.113.7")).toMatchObject({ ok: false, reason: "had" });
  });

  it("is switched off until it is switched on", async () => {
    expect(await gate({ enabled: false }).check(await asked(), "203.0.113.5")).toMatchObject({ ok: false, reason: "off" });
  });

  it("refuses a request signed by another key, a stale or future one, a malformed one, and a state of another line", async () => {
    const g = gate();
    const body = await asked();
    const other = privateKeyToAccount(generatePrivateKey());
    expect(await g.check({ ...body, to: other.address }, "203.0.113.5")).toMatchObject({ ok: false, reason: "badSignature" });
    expect(await g.check(await asked("gentle", NOW - 11 * 60_000), "203.0.113.5")).toMatchObject({ ok: false, reason: "expired" });
    expect(await g.check(await asked("gentle", NOW + 11 * 60_000), "203.0.113.5")).toMatchObject({ ok: false, reason: "expired" });
    expect(await g.check({ ...body, line: "dragon" }, "203.0.113.5")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await g.check({ ...body, state: "-1" }, "203.0.113.5")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await g.check(null, "203.0.113.5")).toMatchObject({ ok: false, reason: "invalid" });
    // a bold pet's state asked for as gentle: the signature is good, the request is not
    const key = privateKeyToAccount(generatePrivateKey());
    const { request, signature } = await signSponsorRequest(key, { line: "gentle", state: stateOf(1), at: NOW });
    expect(await g.check({ ...request, signature }, "203.0.113.5")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("gives one network one pet a day, a /48 three, and the whole game its daily count", async () => {
    const g = gate({ perDay: 5 });
    const take = async (who: string) => {
      const r = await g.check(await asked(), who);
      if (r.ok) g.finish(r.slot, { petId: "1", hatchTx: "0x1", grantTx: "0x2" });
      return r.ok ? "ok" : r.reason;
    };
    expect(await take("2001:db8:1:1::/64")).toBe("ok");
    expect(await take("2001:db8:1:1::/64")).toBe("network");
    expect(await take("2001:db8:1:2::/64")).toBe("ok");
    expect(await take("2001:db8:1:3::/64")).toBe("ok");
    expect(await take("2001:db8:1:4::/64"), "a /48 holds three").toBe("network");
    expect(await take("198.51.100.1")).toBe("ok");
    expect(await take("198.51.100.2")).toBe("ok");
    expect(await take("198.51.100.3"), "the day's five are used").toBe("budget");
  });

  // B9: the day's budget is OKB really spent, not a count of pets
  it("stops for the day when the OKB spent, with the most a request on its way may cost, would pass the budget", async () => {
    const SET_ASIDE = 80_000_000_000_000n;
    const g = gate({ okbPerDayWei: 3n * SET_ASIDE, perDay: 100 });
    const take = async (who: string, spentWei: bigint) => {
      const r = await g.check(await asked(), who);
      if (r.ok) g.finish(r.slot, { petId: "1", hatchTx: "0x1", grantTx: "0x2", spentWei });
      return r.ok ? "ok" : r.reason;
    };
    // two cheap pets (60 000 gwei each) leave room for a third at the most it may cost
    expect(await take("198.51.100.1", 60_000_000_000_000n)).toBe("ok");
    expect(await take("198.51.100.2", 60_000_000_000_000n)).toBe("ok");
    expect(g.spentToday()).toBe(120_000_000_000_000n);
    expect(await take("198.51.100.3", 70_000_000_000_000n)).toBe("ok");
    // 190 000 spent: one more at the most it may cost (80 000) would pass 240 000
    expect(await take("198.51.100.4", 1n)).toBe("budget");
    // a request on its way counts at the most it may cost
    const h = gate({ okbPerDayWei: SET_ASIDE * 2n - 1n, perDay: 100 });
    const first = await h.check(await asked(), "198.51.100.5");
    expect(first.ok).toBe(true);
    expect(await h.check(await asked(), "198.51.100.6"), "the first may still cost its set-aside").toMatchObject({ ok: false, reason: "budget" });
  });

  it("records each pet's cost, adds a later grant's cost to it, and counts a pet from before B9 at the most", async () => {
    const f = file();
    const g = gate({ file: f });
    const key = privateKeyToAccount(generatePrivateKey());
    const r = await g.check(await asked("gentle", NOW, key), "198.51.100.1");
    if (!r.ok) throw new Error(r.reason);
    g.finish(r.slot, { petId: "7", hatchTx: "0x1", grantTx: null, spentWei: 10_000_000_000_000n });
    const again = await g.check(await asked("gentle", NOW, key), "198.51.100.1");
    if (!again.ok) throw new Error(again.reason);
    g.finish(again.slot, { petId: "7", hatchTx: null, grantTx: "0x3", spentWei: 51_000_000_000_000n });
    expect(g.pets()[0]).toMatchObject({ petId: "7", grantTx: "0x3", spentWei: "61000000000000" });
    // a pet kept before costs were recorded counts at the most a pet may cost
    const old = gate({ file: f });
    (old as unknown as { store: { pets: Array<Record<string, unknown>> } }).store.pets.push({ to: "0xold", petId: "1", network: "x", at: NOW, hatchTx: "0x9", grantTx: "0x9" });
    expect(old.spentToday()).toBe(61_000_000_000_000n + 80_000_000_000_000n);
  });

  it("counts a slot taken by a request that sent nothing back as free", async () => {
    const g = gate({ perDay: 1 });
    const r = await g.check(await asked(), "198.51.100.1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    g.release(r.slot);
    expect(await g.check(await asked(), "198.51.100.1")).toMatchObject({ ok: true });
  });

  it("a pet whose gas never arrived may ask again for the gas alone, with the same key", async () => {
    const g = gate();
    const body = await asked();
    const r = await g.check(body, "198.51.100.1");
    if (!r.ok) throw new Error("refused");
    g.finish(r.slot, { petId: "9", hatchTx: "0x1", grantTx: null });
    const again = await g.check(await asked("gentle", NOW, body.key), "198.51.100.1");
    expect(again).toMatchObject({ ok: true, retryGrant: true, petId: "9" });
  });

  it("two requests for the same key at once: one goes, the other is told to wait", async () => {
    const g = gate();
    const key = privateKeyToAccount(generatePrivateKey());
    const [a, b] = await Promise.all([g.check(await asked("gentle", NOW, key), "198.51.100.1"), g.check(await asked("gentle", NOW, key), "198.51.100.2")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("keeps every sponsored pet across a restart, for the numbers page", async () => {
    const f = file();
    const g = new SponsorGate({ file: f, enabled: true, now: () => NOW });
    const body = await asked();
    const r = await g.check(body, "198.51.100.1");
    if (!r.ok) throw new Error("refused");
    g.finish(r.slot, { petId: "9", hatchTx: "0x1", grantTx: "0x2", spentWei: 61_000_000_000_000n });
    const later = new SponsorGate({ file: f, enabled: true, now: () => NOW });
    expect(later.pets()).toEqual([{ to: body.to.toLowerCase(), petId: "9", network: "198.51.100.1", at: NOW, hatchTx: "0x1", grantTx: "0x2", spentWei: "61000000000000" }]);
    expect(later.spentToday(), "the day's spend survives a restart").toBe(61_000_000_000_000n);
    expect(await later.check(body, "198.51.100.9")).toMatchObject({ ok: false, reason: "had" });
  });
});
