import { describe, expect, it } from "vitest";
import { SEND_LIMITS, TooBig, checkSize, sizeNote } from "./sendSize";

const refusal = (f: () => void): TooBig => {
  try {
    f();
  } catch (e) {
    if (e instanceof TooBig) return e;
    throw e;
  }
  throw new Error("not refused");
};

describe("measuring a request before it is sent (P1)", () => {
  it("lets a body at the limit through and refuses one byte more, counting bytes as sent", () => {
    expect(() => checkSize("a".repeat(100), 100)).not.toThrow();
    expect(refusal(() => checkSize("a".repeat(101), 100))).toMatchObject({ unit: "bytes", have: 101, most: 100 });
    // Chinese text is three bytes a character on the wire
    expect(refusal(() => checkSize("灵".repeat(40), 100))).toMatchObject({ have: 120 });
  });

  it("refuses on the server's own count first: a save's characters, a diary's words", () => {
    const e = refusal(() =>
      checkSize("{}", SEND_LIMITS.logBodyBytes, {
        unit: "words",
        have: SEND_LIMITS.logWords + 1,
        most: SEND_LIMITS.logWords,
      }),
    );
    expect(e).toMatchObject({ unit: "words", have: 100_001, most: 100_000 });
    expect(() =>
      checkSize("{}", SEND_LIMITS.moveBodyBytes, {
        unit: "bytes",
        have: SEND_LIMITS.moveChars,
        most: SEND_LIMITS.moveChars,
      }),
    ).not.toThrow();
  });

  it("says the size and the most allowed in the player's language", () => {
    const bytes = new TooBig("bytes", 3_500_000, 3_000_000);
    expect(sizeNote(bytes, "en")).toBe("(3.3 MB; the most is 2.9 MB)");
    expect(sizeNote(bytes, "zh")).toBe("（3.3 MB，最多 2.9 MB）");
    expect(sizeNote(new TooBig("words", 120_000, 100_000), "en")).toBe("(120,000 words; the most is 100,000 words)");
    expect(sizeNote(new TooBig("bytes", 700_001, 700_000), "en")).toBe("(684 KB; the most is 684 KB)");
  });
});
