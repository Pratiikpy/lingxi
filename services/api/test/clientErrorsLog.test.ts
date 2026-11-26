/**
 * R13: what a reported error may put in the server's log, and what it may carry. A report is written to the log as
 * one line; its message, its place and its build each came from a browser and may hold line breaks, so a report could
 * write lines of its own into the log under any date and name it chose. And an error's message can carry a network
 * address (a failed fetch names its host), which names a player's network as surely as a wallet address names a
 * player.
 */
import { describe, expect, it } from "vitest";
import { createErrorLog, scrub } from "../src/clientErrors";

/** Unicode's line and paragraph separators, which end a line as surely as a line feed does. */
const SEPARATORS = String.fromCharCode(0x2028, 0x2029);
/** A line break, a control character or a line separator: nothing of the kind may be in a logged line. */
const CONTROL = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${SEPARATORS}]`);

describe("a reported error in the log (R13)", () => {
  it("is one line: no line break or control character from the report reaches the log or the store", () => {
    const lines: string[] = [];
    const log = createErrorLog({ log: (l) => lines.push(l) });
    log.add({
      message: `boom\n2026-11-26 client error (forged) at /x: an invented line\r\n${SEPARATORS}more\x00\x1b[31m`,
      where: "/play.html\n/assets/a.js:1:2",
      build: "main-1.js\nforged",
    });
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    // its own closing break is the only one
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toMatch(CONTROL);
    const kept = log.latest(1)[0]!;
    expect(kept.message).not.toMatch(CONTROL);
    expect(kept.where).toBe("/play.html /assets/a.js:1:2");
    expect(kept.build).toBe("main-1.js forged");
  });

  it("the same error with and without stray breaks is one error, counted twice", () => {
    const log = createErrorLog();
    log.add({ message: "boom", where: "/play.html a.js:1:2", build: "b" });
    log.add({ message: "boom", where: "/play.html\na.js:1:2", build: "b" });
    expect(log.latest(5)).toHaveLength(1);
    expect(log.latest(1)[0]!.count).toBe(2);
  });
});

describe("scrub and network addresses (R13)", () => {
  it("removes an IPv4 and an IPv6 address, keeping what is around them", () => {
    expect(scrub("fetch to 203.0.113.7:8443 failed")).toBe("fetch to ip…:8443 failed");
    expect(scrub("peer 2001:db8:85a3:0:0:8a2e:370:7334 refused")).toBe("peer ip… refused");
    expect(scrub("peer fe80::1ff:fe23:4567:890a refused")).toBe("peer ip… refused");
  });

  it("leaves a time of day, a version and a place in a file alone", () => {
    expect(scrub("failed at 12:30:45 after 3 tries")).toBe("failed at 12:30:45 after 3 tries");
    expect(scrub("/assets/main-AjRkM4hj.js:1:20345")).toBe("/assets/main-AjRkM4hj.js:1:20345");
    expect(scrub("react 19.2.9 said no")).toBe("react 19.2.9 said no");
  });
});
