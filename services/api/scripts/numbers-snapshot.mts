/**
 * `pnpm numbers:snapshot`: the numbers stores a running server has built (the pet history, the goals, the circuits and the
 * sales), copied into snapshots/xlayer with what they were taken from, so a fresh server starts there instead of walking
 * X Layer from each contract's deployment (snapshot.ts, P3). The contracts and their starting blocks are read from the
 * deploy configuration the server runs with (deploy/pm2.config.cjs) and the deployment record, so a snapshot can only fit
 * the walk that made it. Only chain data is copied: the team's private wallet list (data/team.json) is never read here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { SnapshotMeta } from "../src/snapshot.ts";

const root = resolve(import.meta.dirname, "..", "..", "..");
const require = createRequire(import.meta.url);
const pm2 = require(join(root, "deploy", "pm2.config.cjs")) as {
  apps: Array<{ name: string; env?: Record<string, string> }>;
};
const env = pm2.apps.find((a) => a.name === "lingxi-server")?.env ?? {};
const deployment = JSON.parse(readFileSync(join(root, "packages", "chain", "deployments", "xlayer.json"), "utf8")) as {
  processor?: string;
  processorBlock?: number;
};
const out = join(root, "services", "api", "snapshots", "xlayer");
const need = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`deploy/pm2.config.cjs gives the server no ${k}`);
  return v;
};

const stores = {
  history: need("LINGXI_HISTORY_STORE"),
  goals: need("LINGXI_GOALS_STORE"),
  sales: need("LINGXI_SALES_STORE"),
  circuits: env.LINGXI_CIRCUITS_STORE ?? join(root, "services", "api", "data", "circuits.json"),
};
for (const [name, file] of Object.entries(stores))
  if (!existsSync(file)) throw new Error(`no ${name} store at ${file}: take a snapshot where the server has run`);

// the lowest block every store has reached: the snapshot is complete up to it
const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as { next?: number | Record<string, number> };
const nexts = Object.values(stores).flatMap((f) => {
  const n = read(f).next;
  return typeof n === "number" ? [n] : Object.values(n ?? {});
});
const meta: SnapshotMeta = {
  takenAt: new Date().toISOString(),
  block: Math.min(...nexts) - 1,
  registry: { address: need("LINGXI_REGISTRY").toLowerCase(), fromBlock: Number(need("LINGXI_REGISTRY_FROM")) },
  processor:
    deployment.processor && deployment.processorBlock
      ? {
          address: deployment.processor.toLowerCase(),
          fromBlock: Number(env.LINGXI_PROCESSOR_FROM ?? deployment.processorBlock),
        }
      : null,
  markets: [
    { address: env.LINGXI_MARKET_OKB, fromBlock: Number(env.LINGXI_MARKET_OKB_FROM ?? 0) },
    { address: env.LINGXI_MARKET_BEM, fromBlock: Number(env.LINGXI_MARKET_BEM_FROM ?? 0) },
  ]
    .filter((m): m is { address: string; fromBlock: number } => !!m.address && m.fromBlock > 0)
    .map((m) => ({ address: m.address.toLowerCase(), fromBlock: m.fromBlock })),
};
mkdirSync(out, { recursive: true });
for (const [name, file] of Object.entries(stores)) copyFileSync(file, join(out, `${name}.json`));
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(`snapshot at block ${meta.block}: ${Object.keys(stores).join(", ")} -> ${out}`);
