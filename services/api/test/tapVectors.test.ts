import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Address, type Hex, keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJSON, delegationDigest, normaliseSignature, personalDigest, recoverDigest, recoverStatement, responseDigest, signStatement, strictParse } from "../src/tap";

// the vectors TAP-11 and TAP-13 publish (CC0), copied from TapeOutProtocol/TAPs at 527477e
const dir = join(dirname(fileURLToPath(import.meta.url)), "vectors", "tap");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

interface CanonCase {
  input: string;
  canonical?: string;
  keccak256?: Hex;
  reject?: string;
}

describe("canonical JSON and the strict parser, on every published vector", () => {
  for (const file of ["tap11-canonical-json.json", "tap13-canonical-json-extra.json"]) {
    const cases = load(file).cases as CanonCase[];
    it(`${file}: ${cases.length} cases`, () => {
      for (const c of cases) {
        let out: string | null = null;
        try {
          out = canonicalJSON(strictParse(c.input));
        } catch {
          out = null;
        }
        if (c.reject !== undefined) expect(out, `${c.input} has no canonical form`).toBeNull();
        else {
          expect(out, c.input).toBe(c.canonical);
          expect(keccak256(stringToBytes(out!)), c.input).toBe(c.keccak256);
        }
      }
    });
  }
});

describe("the envelope digest and signature (TAP-13 §5)", () => {
  const v = load("tap13-envelope.json");
  const account = privateKeyToAccount(v.signerKey as Hex);
  it("uses the published test signer", () => expect(account.address).toBe(v.signerAddress));

  for (const c of v.cases as Array<Record<string, unknown>>) {
    it(`${c.name}`, async () => {
      const st = { container: v.container as Address, id: c.id as string, request: { method: c.method as string, params: c.params as Record<string, unknown> }, ok: c.ok as boolean, body: c.body, ts: c.ts as number };
      expect(canonicalJSON({ method: c.method, params: c.params })).toBe(c.canonicalRequest);
      expect(canonicalJSON(c.body)).toBe(c.canonicalBody);
      const { preimage, digest } = responseDigest(st);
      expect((preimage.length - 2) / 2).toBe(139);
      expect(preimage).toBe(c.preimage);
      expect(digest).toBe(c.digest);
      expect(personalDigest(digest)).toBe(c.eip191Digest);
      // our signer produces the same signature (RFC 6979 is deterministic) and it recovers to the signer
      expect(await signStatement(account, st)).toBe(c.sig);
      expect(await recoverStatement(st, c.sig as string)).toBe(c.recovers);
    });
  }

  it("signature encodings: v 0/1 accepted; high s, v 29 and 64 bytes refused", async () => {
    const base = (v.cases as Array<Record<string, unknown>>).find((c) => c.name === v.signatureEncoding.baseCase)!;
    const st = { container: v.container as Address, id: base.id as string, request: { method: base.method as string, params: base.params as Record<string, unknown> }, ok: base.ok as boolean, body: base.body, ts: base.ts as number };
    for (const e of v.signatureEncoding.cases as Array<{ name: string; sig: string; recovers?: string; expect: string }>) {
      const got = await recoverStatement(st, e.sig);
      if (e.expect === "accepted") expect(got, e.name).toBe(e.recovers);
      else expect(got, e.name).toBeNull();
    }
  });

  it("binding negatives: a verifier's own different value recovers to another address", async () => {
    const sig = (v.cases as Array<Record<string, unknown>>).find((c) => c.name === v.bindingNegatives.signatureOfCase)!.sig as string;
    for (const n of v.bindingNegatives.cases as Array<{ name: string; verifierValues: Record<string, unknown>; digest: Hex; recovers: string }>) {
      const w = n.verifierValues;
      const st = { container: w.container as Address, id: w.id as string, request: { method: w.method as string, params: w.params as Record<string, unknown> }, ok: w.ok as boolean, body: w.body, ts: w.ts as number };
      expect(responseDigest(st).digest, n.name).toBe(n.digest);
      const got = await recoverStatement(st, sig);
      expect(got, n.name).toBe(n.recovers);
      expect(got, n.name).not.toBe(v.signerAddress);
    }
  });
});

describe("the delegation (TAP-11 §4)", () => {
  const d = load("tap11-delegation.json");
  it("the worked example's digests on BNB Chain, Base and X Layer", () => {
    for (const x of d.workedExample.digests as Array<{ chainId: number; digest: Hex }>) {
      expect(delegationDigest(x.chainId, d.workedExample.input.container, d.workedExample.input.signer, d.workedExample.input.expires)).toBe(x.digest);
    }
  });
  it("valid delegations recover to the holder; invalid ones do not", async () => {
    for (const x of d.valid as Array<{ name: string; chainId: number; container: Address; signer: Address; expires: number; digest: Hex; sig: string }>) {
      expect(delegationDigest(x.chainId, x.container, x.signer, x.expires), x.name).toBe(x.digest);
      expect(await recoverDigest(x.digest, x.sig), x.name).toBe(d.holderAddress);
    }
    for (const x of d.invalid as Array<{ name: string; chainId: number; container: Address; signer: Address; expires: number; digest?: Hex; sig: string }>) {
      const digest = delegationDigest(x.chainId, x.container, x.signer, x.expires);
      if (x.digest) expect(digest, x.name).toBe(x.digest);
      expect(await recoverDigest(digest, x.sig), x.name).not.toBe(d.holderAddress);
    }
  });
  it("a signature with v 0 or 1 reads as 27 or 28", async () => {
    const x = d.vNormalisation;
    expect(normaliseSignature(x.sig)).not.toBeNull();
    expect(await recoverDigest(x.digest, x.sig)).toBe(x.recoversTo);
  });
});
