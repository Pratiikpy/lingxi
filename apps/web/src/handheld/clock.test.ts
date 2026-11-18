import { afterEach, describe, expect, it, vi } from "vitest";
import { BEAT_MS } from "@lingxi/game";

describe("the browser handheld's minute (A6)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("comes from the game's time, not the device's, once the server has answered", async () => {
    const server = Date.UTC(2026, 10, 18, 12, 0, 30);
    // the device's clock runs three hours fast
    vi.useFakeTimers({ now: server + 3 * 3_600_000, toFake: ["Date"] });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ result: { timestamp: `0x${Math.floor(server / 1000).toString(16)}` } })));
    const { handheldClock, wallBeat } = await import("./clock");
    expect(await handheldClock.sync()).toBe(true);
    expect(wallBeat()).toBe(Math.floor(server / BEAT_MS));
  });

  it("starts from the time the game saved, before its own answer arrives", async () => {
    const gameTime = Date.UTC(2026, 10, 18, 9, 15);
    vi.useFakeTimers({ now: gameTime - 2 * 3_600_000, toFake: ["Date"] });
    // the game last saw its clock two hours ahead of this device
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "lingxi.clock.v1" ? JSON.stringify({ offset: 2 * 3_600_000, seen: gameTime }) : null) });
    const { wallBeat } = await import("./clock");
    expect(wallBeat()).toBe(Math.floor(gameTime / BEAT_MS));
  });
});
