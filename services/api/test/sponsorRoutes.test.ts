/**
 * H4: the sponsor route. A refusal sends nothing and is named; a hatch answers with the pet and both transactions;
 * a pet whose gas never arrived gets the gas alone; what the relayer reports is what the player is told.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signSponsorRequest, type Deployment } from "@lingxi/chain";
import { SponsorGate } from "../src/sponsor";
import { withSponsor, type Sponsoring } from "../src/server";

const NOW = 1_800_000_000_000;
const d = { registry: "0x00000000000000000000000000000000000000bb" } as unknown as Deployment;
const gentle = ((0n << 152n) | 0x1234n).toString();

function app(
  o: {
    enabled?: boolean;
    hatch?: Sponsoring["relayer"]["sponsorHatch"];
    grant?: Sponsoring["relayer"]["sponsorGrant"];
    ip?: string;
  } = {},
) {
  const gate = new SponsorGate({
    file: join(mkdtempSync(join(tmpdir(), "lx-")), "s.json"),
    enabled: o.enabled ?? true,
    now: () => NOW,
  });
  const hatch = vi.fn(
    o.hatch ??
      (async () => ({ ok: true as const, petId: "41", hatchTx: "0xh", grantTx: "0xg", spentWei: 60_000_000_000_000n })),
  );
  const grant = vi.fn(o.grant ?? (async () => ({ ok: true as const, grantTx: "0xg2", spentWei: 51_000_000_000_000n })));
  const a = withSponsor(new Hono(), {
    gate,
    relayer: { sponsorHatch: hatch, sponsorGrant: grant },
    deployment: d,
    who: () => o.ip ?? "198.51.100.1",
  });
  return { a, gate, hatch, grant };
}
const post = async (a: Hono, body: unknown) => {
  const r = await a.request("/api/sponsor/hatch", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const ask = async (key = privateKeyToAccount(generatePrivateKey())) => {
  const { request, signature } = await signSponsorRequest(key, { line: "gentle", state: gentle, at: NOW });
  return { ...request, signature };
};

describe("the sponsor route (H4)", () => {
  it("says whether it is on, so the game offers it only then", async () => {
    expect(await (await app().a.request("/api/sponsor")).json()).toEqual({ ok: true, on: true });
    expect(await (await app({ enabled: false }).a.request("/api/sponsor")).json()).toEqual({ ok: true, on: false });
  });

  it("hatches for a signed device key and answers with the pet and both transactions", async () => {
    const { a, gate, hatch } = app();
    const body = await ask();
    const r = await post(a, body);
    expect(r).toEqual({ status: 200, json: { ok: true, petId: "41", hatchTx: "0xh", grantTx: "0xg" } });
    expect(hatch).toHaveBeenCalledWith(d, body.to.toLowerCase(), "gentle", BigInt(gentle));
    // what the relayer says the sends cost is what the day's OKB budget counts (B9)
    expect(gate.pets()[0]?.spentWei).toBe("60000000000000");
  });

  it("refuses, naming why and sending nothing: switched off, junk, a forged key, twice for one key", async () => {
    const off = app({ enabled: false });
    expect(await post(off.a, await ask())).toMatchObject({ status: 200, json: { ok: false, reason: "off" } });
    const { a, hatch } = app();
    expect(await post(a, { to: "x" })).toMatchObject({ status: 400, json: { reason: "invalid" } });
    const body = await ask();
    expect(await post(a, { ...body, to: privateKeyToAccount(generatePrivateKey()).address })).toMatchObject({
      status: 401,
      json: { reason: "badSignature" },
    });
    expect(hatch).not.toHaveBeenCalled();
    await post(a, body);
    expect(await post(a, body)).toMatchObject({ status: 200, json: { ok: false, reason: "had" } });
    expect(hatch).toHaveBeenCalledTimes(1);
  });

  it("a relayer too low to send gives the slot back and says so", async () => {
    const { a } = app({ hatch: async () => ({ ok: false, reason: "relayLow", detail: "held", spent: false }) });
    const body = await ask();
    expect(await post(a, body)).toMatchObject({ status: 200, json: { ok: false, reason: "relayLow" } });
    // nothing was spent, so the same network may try again
    expect((await post(a, await ask())).json.reason).toBe("relayLow");
  });

  it("a pet whose gas never came gets the gas alone when its key asks again", async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const { a, grant, hatch } = app({
      hatch: async () => ({ ok: true, petId: "41", hatchTx: "0xh", grantTx: null, spentWei: 10_000_000_000_000n }),
    });
    expect((await post(a, await ask(key))).json).toEqual({ ok: true, petId: "41", hatchTx: "0xh", grantTx: null });
    expect((await post(a, await ask(key))).json).toEqual({ ok: true, petId: "41", hatchTx: null, grantTx: "0xg2" });
    expect(hatch).toHaveBeenCalledTimes(1);
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it("a failed hatch is kept as spent: the day's count holds it, and the player is told", async () => {
    const { a, gate } = app({ hatch: async () => ({ ok: false, reason: "error", detail: "reverted", spent: true }) });
    expect(await post(a, await ask())).toMatchObject({ status: 502, json: { ok: false, reason: "error" } });
    expect(gate.pets()).toHaveLength(1);
  });

  it("tells a game whose answer was lost what was kept for its key, and nothing for anyone else", async () => {
    const { a } = app();
    const body = await ask();
    await post(a, body);
    expect(await (await a.request(`/api/sponsor/of/${body.to}`)).json()).toEqual({
      ok: true,
      petId: "41",
      hatchTx: "0xh",
      grantTx: "0xg",
    });
    expect((await a.request(`/api/sponsor/of/${privateKeyToAccount(generatePrivateKey()).address}`)).status).toBe(404);
    expect((await a.request("/api/sponsor/of/nope")).status).toBe(400);
  });
});
