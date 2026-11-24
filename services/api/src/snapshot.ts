/**
 * P3 (H1's finding): a fresh server walked X Layer from each contract's deployment for its numbers, about twenty minutes
 * over the public RPC. The repo ships a snapshot of the stores those walks build (snapshots/xlayer, made by
 * `pnpm numbers:snapshot` from a running server's stores; chain data only: blocks, ids, public addresses), and a store a
 * server does not have yet starts from it, then indexes onward from the snapshot's block. A snapshot is used only where
 * the server walks exactly what it was taken from (the same contracts, from the same blocks): a fork, a local chain or
 * another deployment starts from nothing, as before. A store already on disk is never touched.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** What a snapshot was taken from, recorded beside its stores (meta.json). */
export interface SnapshotMeta {
  /** when it was taken, and the lowest block every store had reached */
  takenAt: string;
  block: number;
  registry: { address: string; fromBlock: number };
  processor: { address: string; fromBlock: number } | null;
  markets: Array<{ address: string; fromBlock: number }>;
}

/** The stores a snapshot holds, by their file name in it. */
export type SnapshotStore = "history" | "goals" | "circuits" | "sales";

export function readSnapshotMeta(dir: string): SnapshotMeta | null {
  const file = join(dir, "meta.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SnapshotMeta;
  } catch {
    return null;
  }
}

const same = (a: string | undefined | null, b: string | undefined | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Whether a store with these settings walks exactly what the snapshot was taken from. */
export function snapshotFits(
  meta: SnapshotMeta,
  store: SnapshotStore,
  walk: {
    registry?: string;
    registryFrom?: number;
    processor?: string;
    processorFrom?: number;
    markets?: Array<{ address: string; fromBlock: number }>;
  },
): boolean {
  if (store === "history" || store === "goals")
    return same(walk.registry, meta.registry.address) && walk.registryFrom === meta.registry.fromBlock;
  if (store === "circuits")
    return (
      !!meta.processor &&
      same(walk.processor, meta.processor.address) &&
      walk.processorFrom === meta.processor.fromBlock
    );
  const mine = [...(walk.markets ?? [])].map((m) => `${m.address.toLowerCase()}@${m.fromBlock}`).sort();
  const theirs = meta.markets.map((m) => `${m.address.toLowerCase()}@${m.fromBlock}`).sort();
  return mine.length > 0 && mine.join() === theirs.join();
}

/**
 * Puts the snapshot's copy of `store` at `file` when there is no file there yet and the snapshot fits; true when it did.
 * `log` hears what was done, so a server's log says where its numbers started.
 */
export function seedStore(
  dir: string,
  store: SnapshotStore,
  file: string | undefined,
  fits: (meta: SnapshotMeta) => boolean,
  log: (line: string) => void = () => undefined,
): boolean {
  if (!file || existsSync(file)) return false;
  const meta = readSnapshotMeta(dir);
  const from = join(dir, `${store}.json`);
  if (!meta || !existsSync(from) || !fits(meta)) return false;
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(from, file);
  log(`numbers: ${store} starts from the snapshot taken at block ${meta.block} (${meta.takenAt})`);
  return true;
}
