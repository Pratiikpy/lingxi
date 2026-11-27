/**
 * P10: what a code costs to keep. Every share a store counts is kept as codes (src/pseudonym.ts), and the lesson library
 * keeps up to 512 of them a lesson. A code was the first 16 characters of the HMAC's hex digest, taken with slice(): in
 * V8 a slice that long is a view that keeps its whole 64-character parent alive, 122.5 bytes a code held in an array,
 * against 42.5 for the same 16 characters made on their own (measured 2026-11-27), and the library at its cap held
 * 343 MB. A code is now made on its own, and it is the same code, character for character, so nothing kept changes.
 */
import { createHmac } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CODE, pseudonym } from "../src/pseudonym";

const KEY = Buffer.alloc(32, 7);

/** A full collection, reached the way a test may: the flag set now, the function taken from a fresh context. */
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};

describe("a code costs only its own sixteen characters to keep (P10)", () => {
  it("keeps under 70 bytes a code held in an array (a slice of the digest kept 122.5)", () => {
    const n = 100_000;
    const before = heap();
    const kept: string[] = [];
    for (let i = 0; i < n; i++) kept.push(pseudonym("library", `caller ${i}`, KEY));
    const each = (heap() - before) / n;
    expect(kept.every((c) => CODE.test(c))).toBe(true);
    expect(each).toBeLessThan(70);
  });

  it("is the same code as before, character for character: no stored code changes", () => {
    // codes written by the slice of the digest, for a fixed key: what every store has kept so far
    const before = (domain: string, value: string) =>
      createHmac("sha256", KEY).update(`${domain}\0${value}`).digest("hex").slice(0, 16);
    expect(pseudonym("address", "203.0.113.9", KEY)).toBe("fba502b7b0697764");
    expect(pseudonym("network", "2001:db8:1::/48", KEY)).toBe("0f1d51ddd7ab1712");
    expect(pseudonym("library", "0123456789abcdef", KEY)).toBe("75d6f531429203df");
    expect(pseudonym("duel", "a1b2c3d4e5f6", KEY)).toBe("610b591ba3c38a6b");
    for (let i = 0; i < 1_000; i++) {
      const value = `198.51.${i >> 8}.${i & 255}`;
      expect(pseudonym("address", value, KEY)).toBe(before("address", value));
    }
  });
});
