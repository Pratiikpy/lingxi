/**
 * P8: pm2's logs on this PC grew without bound (the tunnel's error log was 700 KB and climbing). The watchdog now
 * rotates them: a log past its size is kept compressed and dated, a fixed number of old ones are kept, and the live
 * file is emptied in place, so pm2, which appends to it, carries on writing.
 */
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { rotateLogs } from "../../../deploy/logRotate.mjs";

const dirs: string[] = [];
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "lingxi-logs-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const T = Date.UTC(2026, 10, 26, 3, 0, 0);

describe("rotateLogs (P8)", () => {
  it("keeps a log past its size compressed and dated, and empties the live file in place", () => {
    const d = folder();
    const log = join(d, "lingxi-server-out.log");
    const text = "line\n".repeat(400);
    writeFileSync(log, text);
    const done = rotateLogs(d, { maxBytes: 1_000, keep: 3, now: T });
    expect(done).toEqual(["lingxi-server-out.log"]);
    expect(statSync(log).size, "the live file is emptied").toBe(0);
    const kept = readdirSync(d).filter((f) => f.endsWith(".gz"));
    expect(kept).toEqual(["lingxi-server-out.log.20261126T030000Z.gz"]);
    expect(gunzipSync(readFileSync(join(d, kept[0]!))).toString(), "nothing is lost").toBe(text);
    // the writer carries on at the start of the emptied file
    appendFileSync(log, "after\n");
    expect(readFileSync(log, "utf8")).toBe("after\n");
  });

  it("leaves a log under its size alone", () => {
    const d = folder();
    writeFileSync(join(d, "small.log"), "x".repeat(10));
    expect(rotateLogs(d, { maxBytes: 1_000, keep: 3, now: T })).toEqual([]);
    expect(readdirSync(d)).toEqual(["small.log"]);
  });

  it("keeps only the newest few of each log, and never touches other files", () => {
    const d = folder();
    const log = join(d, "lingxi-tunnel-error.log");
    writeFileSync(join(d, "notes.txt"), "not a log");
    for (let i = 0; i < 5; i++) {
      writeFileSync(log, "y".repeat(2_000));
      rotateLogs(d, { maxBytes: 1_000, keep: 3, now: T + i * 3_600_000 });
    }
    const kept = readdirSync(d)
      .filter((f) => f.startsWith("lingxi-tunnel-error.log.") && f.endsWith(".gz"))
      .sort();
    expect(kept).toEqual([
      "lingxi-tunnel-error.log.20261126T050000Z.gz",
      "lingxi-tunnel-error.log.20261126T060000Z.gz",
      "lingxi-tunnel-error.log.20261126T070000Z.gz",
    ]);
    expect(readFileSync(join(d, "notes.txt"), "utf8")).toBe("not a log");
  });

  it("a folder that is not there is not an error: nothing to rotate", () => {
    expect(rotateLogs(join(tmpdir(), "lingxi-no-such-folder-p8"), { maxBytes: 1, keep: 1, now: T })).toEqual([]);
  });
});
