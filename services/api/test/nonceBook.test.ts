/**
 * P10: the relay's nonce book keeps each nonce it has seen for its window (relayGate.ts), up to 100,000 at once. Each was
 * kept under its whole text, the signer and the nonce joined, 445 bytes a nonce; it is now kept under an 8-byte digest of
 * that text. It still says a nonce seen before is used, a new one is fresh, and a full book is full until its oldest
 * entries' windows pass.
 */
import { describe, expect, it } from "vitest";
import { createNonceBook } from "../src/relayGate";
import { bytesEach } from "./heap";

const signer = "0x00000000000000000000000000000000000000ab";

describe("the relay's nonce book (P10)", () => {
  it("refuses a nonce seen in its window, takes a new one, and is full at its cap until a window passes", () => {
    const book = createNonceBook(3);
    expect(book.use(`${signer}:${"1".repeat(32)}`, 2_000, 1_000)).toBe(true);
    expect(book.use(`${signer}:${"1".repeat(32)}`, 2_000, 1_000)).toBe(false);
    // the same nonce from another signer is another request
    expect(book.use(`0x${"cd".repeat(20)}:${"1".repeat(32)}`, 2_000, 1_000)).toBe(true);
    expect(book.use(`${signer}:${"2".repeat(32)}`, 3_000, 1_000)).toBe(true);
    expect(book.use(`${signer}:${"3".repeat(32)}`, 3_000, 1_000)).toBe("full");
    // once the first two windows have passed, there is room again, and the first nonce stays used while it was held
    expect(book.use(`${signer}:${"3".repeat(32)}`, 3_000, 2_500)).toBe(true);
    expect(book.use(`${signer}:${"2".repeat(32)}`, 3_000, 2_500)).toBe(false);
  });

  it("keeps a nonce in under 150 bytes (its whole text kept 445)", async () => {
    const n = 50_000;
    const [each, book] = await bytesEach(
      n,
      () => createNonceBook(),
      (b) => {
        for (let i = 0; i < n; i++) b.use(`${signer}:${i.toString(16).padStart(32, "0")}`, 10_000_000, 1_000);
      },
    );
    expect(each).toBeLessThan(150);
    expect(book.use(`${signer}:${(1).toString(16).padStart(32, "0")}`, 10_000_000, 1_000)).toBe(false);
  });
});
