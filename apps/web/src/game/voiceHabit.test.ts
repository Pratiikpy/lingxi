// @vitest-environment happy-dom
/**
 * G9: with no server to write its line (the on-chain copy), the pet still says its choice aloud, in its strongest
 * habit's words, never at random.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HABIT, HABIT_LINES, momentText, type Frame } from "@lingxi/game";
import { leave, visit } from "./testGame";

afterEach(() => leave());

describe("the pet speaks without a server (G9)", () => {
  it("says its choice in its strongest habit's words", async () => {
    await visit({ at: Date.UTC(2026, 10, 23, 9) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no server");
      }),
    );
    const { useGame } = await import("./store");
    const { useVoice } = await import("./voice");
    useGame.getState().hatch("gentle", "Kiri");
    const p0 = useGame.getState().pet!;
    const pet = { ...p0, asleep: false, traits: { ...p0.traits, shy: HABIT + 2 } };
    await useVoice.getState().speak(pet, "en", true);
    const want = pet.last.want;
    const plain = momentText({ want } as Frame, "en");
    const line = useVoice.getState().line;
    expect(line).not.toBeNull();
    expect(line).toContain(Object.values(HABIT_LINES.shy).find((l) => line!.includes(l.en))?.en ?? "missing");
    expect(line).not.toBe(plain);
    vi.unstubAllGlobals();
  });
});
