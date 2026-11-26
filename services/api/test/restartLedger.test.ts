/**
 * R17: every start of the server has a named cause. pm2's log showed 219 starts in eleven days, all of them commanded
 * (none a crash), but nothing said who commanded which: 84 could be matched to no release and no watchdog action. The
 * ledger is one line for each release, each watchdog restart and each start; a start with no cause written in the
 * three minutes before it is unexplained, and the health report counts those.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainStarts, noteRestart, readLedger, startsSummary } from "../src/restartLedger";

const file = () => join(mkdtempSync(join(tmpdir(), "lingxi-ledger-")), "restarts.log");
const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 10, 26, 10, minute, second)).toISOString();

describe("the restart ledger (R17)", () => {
  it("a start is explained by the release or the watchdog action written just before it, and by nothing else", () => {
    const starts = explainStarts([
      { at: at(0), who: "release", why: "69da88f" },
      { at: at(0, 40), who: "server", why: "start" },
      { at: at(20), who: "watchdog", why: "restart-server: no answer here 3 times" },
      { at: at(20, 15), who: "server", why: "start" },
      // nothing written before this one: a reboot, or a restart by hand
      { at: at(40), who: "server", why: "start" },
      // a release long before does not explain a start now
      { at: at(50), who: "release", why: "abc1234" },
      { at: at(58), who: "server", why: "start" },
    ]);
    expect(starts.map((s) => s.cause)).toEqual(["release", "watchdog", "unexplained", "unexplained"]);
    expect(starts[0]!.why).toBe("69da88f");
    expect(starts[1]!.why).toContain("no answer here");
  });

  it("the report counts the last day's starts, how many had no cause, and when the last such was", () => {
    const now = Date.UTC(2026, 10, 26, 12, 0);
    const s = startsSummary(
      [
        { at: new Date(now - 30 * 3_600_000).toISOString(), who: "server", why: "start" },
        { at: at(0), who: "release", why: "69da88f" },
        { at: at(0, 40), who: "server", why: "start" },
        { at: at(40), who: "server", why: "start" },
      ],
      now,
    );
    expect(s).toEqual({ lastDay: 2, unexplained: 1, lastUnexplained: at(40) });
  });

  it("writes one line a note, reads back only what is whole, and keeps the file from growing without end", () => {
    const f = file();
    noteRestart(f, "release", "69da88f\nforged line", () => Date.parse(at(1)));
    noteRestart(f, "server", "start", () => Date.parse(at(2)));
    writeFileSync(f, `${readFileSync(f, "utf8")}not json\n{"at":"x"}\n`);
    const kept = readLedger(f);
    expect(kept).toEqual([
      { at: at(1), who: "release", why: "69da88f forged line" },
      { at: at(2), who: "server", why: "start" },
    ]);
    // far past its limit, the oldest half goes
    for (let i = 0; i < 400; i++) noteRestart(f, "server", "start", () => Date.parse(at(3)) + i * 1000, 4_000);
    expect(readFileSync(f, "utf8").length).toBeLessThanOrEqual(4_200);
    expect(readLedger(f).at(-1)!.who).toBe("server");
    expect(readLedger("no/such/file")).toEqual([]);
  });
});
