// @vitest-environment happy-dom
/**
 * H11: when teaching in words is not on offer, the game says why. The on-chain copy has no server at all (it is not
 * offline, and must not say so); a device with no connection is offline; a server that does not answer, or that has
 * teaching switched off, is each named for what it is.
 */
import { describe, expect, it } from "vitest";
import { readTeachingState } from "./api";

const answering = (body: unknown) => (async () => ({ json: async () => body })) as unknown as typeof fetch;
const down = (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;

describe("why teaching in words is or is not on offer (H11)", () => {
  it("is ready when the server says teaching is on", async () => {
    expect(await readTeachingState("https://lingxi.knole.me", true, answering({ teach: true }))).toBe("ready");
  });

  it("says the on-chain copy has no server, without asking anyone, even when the device is online", async () => {
    let asked = false;
    const spy = (async () => ((asked = true), { json: async () => ({ teach: true }) })) as unknown as typeof fetch;
    expect(await readTeachingState("", true, spy)).toBe("noServer");
    expect(asked).toBe(false);
  });

  it("says offline only when the device has no connection", async () => {
    expect(await readTeachingState("https://lingxi.knole.me", false, down)).toBe("offline");
  });

  it("tells a server that does not answer from one with teaching switched off", async () => {
    expect(await readTeachingState("https://lingxi.knole.me", true, down)).toBe("unreachable");
    expect(await readTeachingState("https://lingxi.knole.me", true, answering({ teach: false }))).toBe("off");
    expect(await readTeachingState("https://lingxi.knole.me", true, answering("<html>"))).toBe("off");
  });
});
