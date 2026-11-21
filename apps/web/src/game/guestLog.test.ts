// @vitest-environment happy-dom
/** A148: the store keeps the last thirty days of a guest pet's log when it saves it, and never cuts a kept pet's. */
import { afterEach, describe, expect, it } from "vitest";
import { GUEST_LOG_KEEP, type Pet } from "@lingxi/game";
import { leave, visit } from "./testGame";

const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
afterEach(() => leave());

const saved = (storage: { getItem(k: string): string | null }): Pet[] => (JSON.parse(storage.getItem("lingxi.pets.v2") ?? "{}") as { pets: Pet[] }).pets;
const long = (p: Pet): Pet => ({ ...p, pendingLog: Array.from({ length: 32 * 1440 }, (_, i) => (i * 40_503 + 17) & 0xffff), logMarks: [[0, 1_000]] });

describe("a guest pet's log on save (A148)", () => {
  it("is cut to the last thirty days for a pet not kept on chain", async () => {
    const { storage } = await visit({ at: T0 });
    const { useGame } = await import("./store");
    await import("./chain");
    useGame.getState().hatch("gentle", "Mochi");
    const pet = useGame.getState().pet!;
    useGame.getState().replace(long(pet));
    expect(saved(storage)[0]!.pendingLog.length).toBe(GUEST_LOG_KEEP);
  });

  it("is kept whole for a pet kept on chain, and for one staying with a sitter", async () => {
    const { storage } = await visit({ at: T0 });
    const { useGame } = await import("./store");
    const chain = await import("./chain");
    useGame.getState().hatch("gentle", "Mochi");
    const pet = useGame.getState().pet!;
    chain.setRecordOf(pet, { petId: "7", hatchTx: `0x${"0".repeat(64)}`, lastDay: 0, owner: "0x1111111111111111111111111111111111111111", bornChain: T0 / 1000, brains: { "[]": "1" }, brainKey: "[]" });
    useGame.getState().replace(long(pet));
    expect(saved(storage)[0]!.pendingLog.length).toBe(32 * 1440);
    chain.setRecordOf(pet, null);
    useGame.getState().replace({ ...long(pet), sitting: { code: "c", key: "k", until: T0 + 86_400_000, owner: null, name: "Bao" } });
    expect(saved(storage)[0]!.pendingLog.length).toBe(32 * 1440);
  });
});
