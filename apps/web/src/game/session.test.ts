// @vitest-environment happy-dom
/**
 * This device's key (H4, P3). The key is made from the browser's own random source, without viem's curve maths, and the
 * account that signs with it is built from viem's key half when first needed. A key is a valid secp256k1 private key,
 * kept in storage, the same across calls and visits, never replaced while one is kept, and the account's address is the
 * one viem derives from it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { leave, reload, visit } from "./testGame";

const KEY = "lingxi.session.v1";
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const AT = Date.UTC(2026, 10, 23, 9);

afterEach(() => leave());

describe("this device's key (P3)", () => {
  it("is made once, from the random source, as a valid key, kept, and the account signs as viem derives it", async () => {
    const v = await visit({ at: AT });
    const { sessionAccount, exportSessionKey } = await import("./session");
    const account = await sessionAccount();
    const key = v.storage.getItem(KEY)!;
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    const n = BigInt(key);
    expect(n > 0n && n < N, "inside the curve's range").toBe(true);
    expect(account.address).toBe(privateKeyToAccount(key as `0x${string}`).address);
    expect(await sessionAccount(), "one account for the visit").toBe(account);
    expect(exportSessionKey()).toBe(key);
    const signature = await account.signMessage({ message: "lingxi" });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);

    // the next visit reads the same key and builds the same account
    await reload(v.storage, { at: AT + 60_000 });
    const again = await import("./session");
    expect((await again.sessionAccount()).address).toBe(account.address);
    expect(v.storage.getItem(KEY)).toBe(key);
  });

  it("keeps a key already in storage, and makes a new one only when what is kept is not a key", async () => {
    const kept = `0x${"ab".repeat(32)}`;
    const v = await visit({ at: AT });
    v.storage.setItem(KEY, kept);
    const first = await import("./session");
    expect((await first.sessionAccount()).address).toBe(privateKeyToAccount(kept as `0x${string}`).address);

    const w = await visit({ at: AT });
    w.storage.setItem(KEY, "0xnot-a-key");
    const second = await import("./session");
    await second.sessionAccount();
    expect(w.storage.getItem(KEY)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(w.storage.getItem(KEY)).not.toBe("0xnot-a-key");
  });

  it("makes distinct keys on distinct devices", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const v = await visit({ at: AT });
      const { exportSessionKey } = await import("./session");
      seen.add(exportSessionKey());
      expect(v.storage.getItem(KEY)).toBe([...seen].at(-1));
    }
    expect(seen.size).toBe(20);
  });
});
