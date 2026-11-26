// @vitest-environment happy-dom
/**
 * P8: the game reports its own uncaught errors to its server. Only errors from the game's own scripts (not a
 * browser extension's), each distinct error once, at most five a visit; and with no server, as the on-chain copy is
 * built, nothing is sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startErrorReports } from "./errorReport";

type Sent = { url: string; body: { message: string; where: string; build: string } };

const listen = (base: string) => {
  const sent: Sent[] = [];
  const stop = startErrorReports({
    base,
    build: "index-abc.js",
    send: (url, body) => sent.push({ url, body }),
  });
  return { sent, stop };
};

const raise = (message: string, filename = `${location.origin}/assets/index-abc.js`) =>
  window.dispatchEvent(new ErrorEvent("error", { message, filename, lineno: 12, colno: 34 }));

let stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
  vi.restoreAllMocks();
});

describe("the game reports its own errors (P8)", () => {
  it("sends an error from its own script: its message, where, and the build", () => {
    const r = listen("https://lingxi.example");
    stops.push(r.stop);
    raise("TypeError: x is undefined");
    expect(r.sent).toEqual([
      {
        url: "https://lingxi.example/api/errors",
        body: {
          message: "TypeError: x is undefined",
          where: `${location.pathname} /assets/index-abc.js:12:34`,
          build: "index-abc.js",
        },
      },
    ]);
  });

  it("an extension's error, or one with no file, is not the game's and is not sent", () => {
    const r = listen("https://lingxi.example");
    stops.push(r.stop);
    raise("boom", "chrome-extension://abc/content.js");
    raise("Script error.", "");
    expect(r.sent).toEqual([]);
  });

  it("a promise the game left unhandled is sent when its stack is the game's", () => {
    const r = listen("https://lingxi.example");
    stops.push(r.stop);
    const ours = new Error("chain read failed");
    ours.stack = `Error: chain read failed\n    at read (${location.origin}/assets/index-abc.js:5:6)`;
    const theirs = new Error("ext");
    theirs.stack = "Error: ext\n    at x (chrome-extension://abc/content.js:1:1)";
    for (const reason of [ours, theirs])
      window.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason, promise: Promise.resolve() }));
    expect(r.sent.map((s) => s.body.message)).toEqual(["Error: chain read failed"]);
    expect(r.sent[0]!.body.where).toBe(`${location.pathname} /assets/index-abc.js:5:6`);
  });

  it("each distinct error once, and at most five a visit", () => {
    const r = listen("https://lingxi.example");
    stops.push(r.stop);
    raise("same");
    raise("same");
    for (let i = 0; i < 10; i++) raise(`error ${i}`);
    expect(r.sent.map((s) => s.body.message)).toEqual(["same", "error 0", "error 1", "error 2", "error 3"]);
  });

  it("with no server, as the on-chain copy is built, nothing is sent and nothing listens", () => {
    const on = vi.spyOn(window, "addEventListener");
    const r = listen("");
    stops.push(r.stop);
    raise("TypeError: x");
    expect(r.sent).toEqual([]);
    expect(on).not.toHaveBeenCalled();
  });

  it("long fields are cut to what the server takes", () => {
    const r = listen("https://lingxi.example");
    stops.push(r.stop);
    raise("x".repeat(1_000));
    expect(r.sent[0]!.body.message).toHaveLength(300);
  });
});
