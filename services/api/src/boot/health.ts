/**
 * The health report (P7: out of server.ts's boot).
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { BrainRelayer } from "../relayer";
import { budgetedClient, createTokenBudget } from "../tokenBudget";
import { createJobs } from "../jobs";
import { serverBuild, backupStatus, watchdogStatus, storeSizes } from "../routes/health";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

import type { HealthDetail } from "../server";

/**
 * What /api/health reports beyond its switches; chain reads are cached so a busy health check costs nothing.
 */
export function healthDetail({
  jobs,
  client,
  modelBudget,
  relayer,
  watch,
  dataDir,
}: {
  jobs: ReturnType<typeof createJobs>;
  client: ReturnType<typeof budgetedClient> | null;
  modelBudget: ReturnType<typeof createTokenBudget>;
  relayer: BrainRelayer | null;
  watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number };
  dataDir: string;
}) {
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  const detail: HealthDetail = async () => {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const [head, relayerWei, fees] = await Promise.all([
      watch.head?.().catch(() => null) ?? null,
      relayer?.balance().catch(() => null) ?? null,
      relayer?.fees().catch(() => null) ?? null,
    ]);
    // how many more tape-outs the relayer's BEM pays the transistor fee for (two kinds minted each, at most) (A40)
    const bemTapeouts =
      fees && fees.feeIn === "bem" && fees.protocolFee > 0n ? Number(fees.bem / (fees.protocolFee * 2n)) : null;
    const value = {
      jobs: Object.fromEntries(
        jobs.status().map((j) => [j.name, j.healthy ? "ok" : `failing: ${j.lastError?.message ?? "?"}`]),
      ),
      // which background jobs have finished a first pass (P3a): a fresh fork answers slowly until they have
      jobsRan: Object.fromEntries(jobs.status().map((j) => [j.name, j.lastOk !== undefined || j.failures > 0])),
      indexerLagBlocks: head !== null && watch.indexed ? Number(head) - watch.indexed() : null,
      packetsLagBlocks: head !== null && watch.packets ? Number(head) - watch.packets() : null,
      relayerOkb: relayerWei === null ? null : Number(relayerWei) / 1e18,
      // the alarm the outside check turns into an issue for Prateek: top the relayer up before players are refused
      relayerLow: relayerWei !== null && Number(relayerWei) / 1e18 < Number(process.env.LINGXI_RELAY_ALARM_OKB ?? 0.02),
      relayerBem: fees ? Number(fees.bem) / 1e8 : null,
      relayFeeIn: fees?.feeIn ?? null,
      relayerBemTapeouts: bemTapeouts,
      // the same alarm for BEM: below ten tape-outs' transistor fees, top it up before players are refused
      relayerBemLow: bemTapeouts !== null && bemTapeouts < Number(process.env.LINGXI_RELAY_ALARM_BEM_TAPEOUTS ?? 10),
      relayerUsage: relayer?.usage() ?? null,
      modelTokensToday: client
        ? {
            used: modelBudget.used(),
            perDay: modelBudget.perDay,
            perAddress: modelBudget.perAddress,
            ...modelBudget.measured(),
          }
        : null,
      backup: backupStatus(),
      watchdog: watchdogStatus(),
      // P3b: the build this server runs (dist/build.json beside it), or "source" when it runs through tsx; the status
      // check holds it to the checkout
      server: serverBuild(),
      // the process's own memory, in MB: a store or cache growing without end shows here first
      memoryMb: Object.fromEntries(
        Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1e5) / 10]),
      ),
      storesKb: await storeSizes(dataDir),
    };
    cached = { at: Date.now(), value };
    return value;
  };
  return { detail };
}
