/**
 * P3: a fresh server's numbers start from the snapshot shipped in the repo, and only where it fits: the store must be
 * missing, and the server must walk exactly the contracts, from exactly the blocks, the snapshot was taken from.
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type SnapshotMeta, seedStore, snapshotFits } from "../src/snapshot";

const meta: SnapshotMeta = {
  takenAt: "2026-11-24T00:00:00Z",
  block: 76_700_000,
  registry: { address: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99", fromBlock: 75_968_151 },
  processor: { address: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e", fromBlock: 75_968_095 },
  markets: [
    { address: "0xaaaa000000000000000000000000000000000001", fromBlock: 76_000_000 },
    { address: "0xbbbb000000000000000000000000000000000002", fromBlock: 76_100_000 },
  ],
};

function snapshotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  for (const s of ["history", "goals", "circuits", "sales"])
    writeFileSync(join(dir, `${s}.json`), JSON.stringify({ from: "snapshot", store: s }));
  return dir;
}

describe("a fresh server's numbers start from the snapshot (P3)", () => {
  it("fits only the same contracts walked from the same blocks", () => {
    const reg = {
      registry: meta.registry.address.toUpperCase().replace("0X", "0x"),
      registryFrom: meta.registry.fromBlock,
    };
    expect(snapshotFits(meta, "history", reg)).toBe(true);
    expect(snapshotFits(meta, "goals", reg)).toBe(true);
    expect(snapshotFits(meta, "history", { ...reg, registryFrom: meta.registry.fromBlock + 1 }), "a later start").toBe(
      false,
    );
    expect(
      snapshotFits(meta, "history", {
        registry: "0x0000000000000000000000000000000000000001",
        registryFrom: meta.registry.fromBlock,
      }),
      "another registry",
    ).toBe(false);
    expect(
      snapshotFits(meta, "circuits", { processor: meta.processor!.address, processorFrom: meta.processor!.fromBlock }),
    ).toBe(true);
    expect(
      snapshotFits(meta, "circuits", { processor: meta.processor!.address, processorFrom: 76_250_000 }),
      "a fork's walk from its own block",
    ).toBe(false);
    expect(snapshotFits(meta, "sales", { markets: [...meta.markets].reverse() }), "the same markets in any order").toBe(
      true,
    );
    expect(snapshotFits(meta, "sales", { markets: [meta.markets[0]!] }), "one market short").toBe(false);
    expect(snapshotFits(meta, "sales", { markets: [] })).toBe(false);
  });

  it("puts the snapshot's store where none is, says so, and never touches a store already there", () => {
    const dir = snapshotDir();
    const data = mkdtempSync(join(tmpdir(), "data-"));
    const lines: string[] = [];
    const file = join(data, "nested", "history-xlayer.json");
    expect(
      seedStore(
        dir,
        "history",
        file,
        () => true,
        (l) => lines.push(l),
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ from: "snapshot", store: "history" });
    expect(lines[0]).toContain("block 76700000");

    writeFileSync(file, JSON.stringify({ from: "its own walk" }));
    expect(
      seedStore(dir, "history", file, () => true),
      "a store already there",
    ).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ from: "its own walk" });
  });

  it("leaves a store to start from nothing when the snapshot does not fit, is missing, or there is no store file", () => {
    const dir = snapshotDir();
    const data = mkdtempSync(join(tmpdir(), "data-"));
    const file = join(data, "goals.json");
    expect(seedStore(dir, "goals", file, () => false)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(
      seedStore(mkdtempSync(join(tmpdir(), "empty-")), "goals", file, () => true),
      "no snapshot",
    ).toBe(false);
    expect(
      seedStore(dir, "goals", undefined, () => true),
      "a store kept in memory only",
    ).toBe(false);
  });
});
