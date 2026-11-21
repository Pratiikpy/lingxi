/** H13: pet letters over TapeRelay. The address a player's relay identity has, and the letter a pet writes. */
import { describe, expect, it } from "vitest";
import { PET_LETTER_MAX, isRelayAddress, readLetter, writeLetter } from "../src/letters";

const ADDR = "key:0x0123456789abcdef0123456789abcdef01234567@relay3.taperelay.com";

describe("a relay address (H13)", () => {
  it("is a TapeRelay user identity on one of the five official nodes, in its exact form", () => {
    expect(isRelayAddress(ADDR)).toBe(true);
    expect(isRelayAddress(`${ADDR}:4246`)).toBe(true);
    for (const bad of [
      ADDR.toUpperCase(),
      ADDR.replace("relay3", "relay6"),
      ADDR.replace("taperelay.com", "taperelay.com.evil.io"),
      ADDR.replace("0x0123", "0x012"),
      `${ADDR}:443`,
      `${ADDR} `,
      `key:0x${"a".repeat(40)}@relay1.taperelay.com/x`,
      "1.2.419.5",
      42,
      null,
    ])
      expect(isRelayAddress(bad), String(bad)).toBe(false);
  });
});

describe("a pet's letter (H13)", () => {
  const from = { pet: "Momo", player: "abc123def456" };
  it("goes from one pet to one pet, at most 600 characters, and reads back the same", () => {
    const w = writeLetter({ from, toPet: "Lulu", text: "  Hello, Lulu!  " });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(readLetter(w.body)).toEqual({ ok: true, letter: { from, toPet: "Lulu", text: "Hello, Lulu!" } });
  });
  it("refuses an empty letter and one past the limit, counting characters, not bytes", () => {
    expect(writeLetter({ from, toPet: "Lulu", text: "   " })).toEqual({ ok: false, reason: "empty" });
    expect(writeLetter({ from, toPet: "Lulu", text: "字".repeat(PET_LETTER_MAX) }).ok).toBe(true);
    expect(writeLetter({ from, toPet: "Lulu", text: "字".repeat(PET_LETTER_MAX + 1) })).toEqual({ ok: false, reason: "tooLong" });
    expect(writeLetter({ from, toPet: "Lulu", text: "😀".repeat(PET_LETTER_MAX) }).ok, "an emoji is one character").toBe(true);
  });
  it("reads only a letter in its own form, and shows any name as it would be shown in the game", () => {
    expect(readLetter("not json").ok).toBe(false);
    expect(readLetter(JSON.stringify({ lx: 2, from, toPet: "Lulu", text: "hi" })).ok).toBe(false);
    expect(readLetter(JSON.stringify({ lx: 1, from, toPet: "Lulu", text: "x".repeat(PET_LETTER_MAX + 1) })).ok).toBe(false);
    expect(readLetter(JSON.stringify({ lx: 1, from: { pet: 5, player: "x" }, toPet: "Lulu", text: "hi" })).ok).toBe(false);
    const hidden = readLetter(JSON.stringify({ lx: 1, from: { pet: "Mo​mo", player: "abc123def456" }, toPet: "Lulu", text: "hi" }));
    expect(hidden.ok && hidden.letter.from.pet).not.toBe("Momo");
  });
});
