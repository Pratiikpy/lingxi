/**
 * R5: the daily backup (deploy/backup.mjs), run for real on a scratch data folder, with a local folder standing in
 * for Google Drive. The server's address key (data/ip-key) never leaves this PC: it is in the local copy, which sits
 * on the same disk as the key, and not in the Drive copy, since with the key a coded IPv4 address can be reversed by
 * trying every address. Drive keeps 30 days, so what is removed from the server is gone from every copy within a
 * month. Needs rclone (as the backup does); without it the test says so and is skipped.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const hasRclone = (() => {
  try {
    execFileSync("rclone", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const scratch = mkdtempSync(join(tmpdir(), "lingxi-backup-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasRclone)("the daily backup (R5)", () => {
  const data = join(scratch, "data");
  const local = join(scratch, "local");
  const drive = join(scratch, "drive");
  mkdirSync(join(data, "sitting"), { recursive: true });
  writeFileSync(join(data, "ip-key"), "k".repeat(32));
  writeFileSync(join(data, "agents.json"), "{}");
  writeFileSync(join(data, "sitting", "p1.json"), "{}");
  // Drive already holds a copy from 40 days ago and one from 10 days ago
  for (const d of [day(40), day(10)]) {
    mkdirSync(join(drive, d), { recursive: true });
    writeFileSync(join(drive, d, "agents.json"), "{}");
  }

  const run = spawnSync(process.execPath, [join(root, "deploy", "backup.mjs")], {
    env: { ...process.env, LINGXI_DATA_DIR: data, LINGXI_BACKUP_DIR: local, LINGXI_BACKUP_REMOTE: drive },
    encoding: "utf8",
  });
  const today = day(0);

  it("completes, and says so", () => {
    expect(run.status, run.stdout + run.stderr).toBe(0);
    const last = JSON.parse(readFileSync(join(local, "last.json"), "utf8")) as Record<string, unknown>;
    expect(last).toMatchObject({ local: true, drive: true, error: null });
  });

  it("keeps the address key on this PC: in the local copy, not in the Drive copy", () => {
    expect(existsSync(join(local, today, "ip-key")), "local copy has the key").toBe(true);
    expect(existsSync(join(drive, today, "ip-key")), "Drive copy has no key").toBe(false);
    expect(existsSync(join(drive, today, "agents.json")), "the stores are in Drive").toBe(true);
    expect(existsSync(join(drive, today, "sitting", "p1.json"))).toBe(true);
  });

  it("removes Drive copies older than 30 days and keeps the newer ones", () => {
    const left = readdirSync(drive).sort();
    expect(left).toEqual([day(10), today].sort());
  });
});
