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
import type { ErrorLog } from "../clientErrors";
import { serverBuild, backupStatus, watchdogStatus, storeSizes } from "../routes/health";
import { LEDGER_FILE, readLedger, startsSummary } from "../restartLedger";
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
  errors,
}: {
  jobs: ReturnType<typeof createJobs>;
  client: ReturnType<typeof budgetedClient> | null;
  modelBudget: ReturnType<typeof createTokenBudget>;
  relayer: BrainRelayer | null;
  watch: { indexed?: () => number; head?: () => Promise<bigint>; packets?: () => number };
  dataDir: string;
  /** P8: the game's own errors, reported by players' browsers */
  errors?: ErrorLog;
}) {
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  const detail: HealthDetail = async () => {
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    // P8: whether the chain answers, said on every refresh with the reason when it does not, so a dead RPC is named
    // within a minute (this report is cached 30 s) rather than shown as a blank
    let chain = watch.head ? "ok" : "not watched";
    const [head, relayerWei, fees] = await Promise.all([
      // the health report says null for what it could not read, and reports the rest
      watch.head?.().catch((e: unknown) => {
        const why = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
        chain = `unreachable: ${why.slice(0, 160)}`;
        return null;
      }) ?? null,
      // the relayer's balance and fees: null when they cannot be read, the rest of the report still given
      relayer?.balance().catch(() => null) ?? null,
      relayer?.fees().catch(() => null) ?? null,
    ]);
    // how many more tape-outs the relayer's BEM pays the transistor fee for (two kinds minted each, at most) (A40)
    const bemTapeouts =
      fees && fees.feeIn === "bem" && fees.protocolFee > 0n ? Number(fees.bem / (fees.protocolFee * 2n)) : null;
    const value = {
      chain,
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
      // P8: the game's own uncaught errors, as players' browsers report them (scrubbed; no client is named)
      clientErrors: errors ? { lastHour: errors.lastHour(), latest: errors.latest(5) } : null,
      backup: backupStatus(),
      watchdog: watchdogStatus(),
      // R17: the last day's starts, and how many followed no release and no watchdog action (restartLedger.ts)
      starts: LEDGER_FILE ? startsSummary(readLedger(LEDGER_FILE)) : null,
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
