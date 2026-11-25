/**
 * The relay's checks and the free keep (P7: out of server.ts's boot).
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { join } from "node:path";
import { Hono } from "hono";
import { BrainRelayer } from "../relayer";
import { SponsorGate } from "../sponsor";
import { RelayQuota } from "../relayGate";
import { parseEther, type PublicClient } from "viem";
import { type Deployment, petRegistryAbi, readPet } from "@lingxi/chain";
import { clientIp } from "../clientIp";
import { type Sponsoring, withSponsor } from "../routes/season";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

import type { KeeperCheck, PetOnChainReader, SettledCheck } from "../server";

/**
 * What the relay asks of X Layer before it tapes out for a player: who may keep a pet, whether a pet is settled
 * (A40), each pet's and signer's share (A142), and a pet's brain and parents (A75).
 */
export function relayChecks({
  chainCtx,
  dataDir,
}: {
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  dataDir: string;
}) {
  // who may keep a pet, read from PetRegistry on X Layer at the moment of the request
  const isKeeper: KeeperCheck | undefined = chainCtx
    ? async (petId, who) =>
        (await chainCtx.pub.readContract({
          address: chainCtx.deployment.registry,
          abi: petRegistryAbi,
          functionName: "isKeeper",
          args: [BigInt(petId), who],
        })) as boolean
    : undefined;
  // A40: sponsored tape-outs go first to pets with standing on chain. A settled pet stays settled (its days and age
  // only grow), so it is remembered for good; an unsettled one is asked again after ten minutes
  const settledPets = new Set<string>();
  const unsettledAt = new Map<string, number>();
  const isSettled: SettledCheck | undefined = chainCtx
    ? async (petId) => {
        if (settledPets.has(petId)) return true;
        const asked = unsettledAt.get(petId);
        if (asked !== undefined && Date.now() - asked < 10 * 60_000) return false;
        const yes = (await chainCtx.pub.readContract({
          address: chainCtx.deployment.registry,
          abi: petRegistryAbi,
          functionName: "isSettled",
          args: [BigInt(petId)],
        })) as boolean;
        if (unsettledAt.size > 100_000) unsettledAt.clear();
        if (yes) {
          settledPets.add(petId);
          unsettledAt.delete(petId);
        } else unsettledAt.set(petId, Date.now());
        return yes;
      }
    : undefined;
  const quota = new RelayQuota(
    {
      perPetPerDay: 6,
      perSignerPerDay: 12,
      perHour: Number(process.env.LINGXI_RELAY_PER_HOUR ?? 12),
      perDay: Number(process.env.LINGXI_RELAY_PER_DAY ?? 200),
      newcomerShare: Number(process.env.LINGXI_RELAY_NEWCOMER_SHARE ?? 0.25),
      lifetime: { newcomer: 3, settled: 40 },
      // settled pets draw two an hour per signer, and a quarter of each hour waits for pets not served today (A142)
      settledPerSignerPerHour: 2,
      keptForUnserved: 0.25,
    },
    process.env.LINGXI_RELAY_QUOTA_FILE ?? join(dataDir, "relay-quota.json"),
  );
  // a pet's brain and parents as PetRegistry has them, read when a child relay asks (A75)
  const petOnChain: PetOnChainReader | undefined = chainCtx
    ? async (petId) => {
        try {
          const p = await readPet(chainCtx.pub, chainCtx.deployment, BigInt(petId));
          if (!p.born) return null;
          return {
            brainId: p.brainId.toString(),
            parents: p.parentA && p.parentB ? [p.parentA.toString(), p.parentB.toString()] : null,
          };
        } catch (e) {
          if (/Nonexistent|NotFound|nonexistent/i.test((e as Error).message)) return null;
          throw e;
        }
      }
    : undefined;
  return { isKeeper, isSettled, quota, petOnChain };
}

/**
 * A pet kept on X Layer for a player with no wallet (H4); whether the free keep is on is what the numbers page
 * says (C2).
 */
export function mountSponsor({
  chainCtx,
  relayer,
  dataDir,
  app,
}: {
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  relayer: BrainRelayer | null;
  dataDir: string;
  app: Hono;
}) {
  // whether the free keep is on, for the numbers page (C2): set where the gate is made
  let sponsorOn = () => false;
  {
    // a pet kept on X Layer for a player with no wallet (H4): it spends the relayer's OKB, so it is off unless the
    // server is started with LINGXI_SPONSOR=on; a store that cannot be read turns it off rather than forget who had one
    let sponsoring: Sponsoring | null = null;
    sponsorOn = () => !!sponsoring?.gate.enabled;
    try {
      const gate = new SponsorGate({
        file: process.env.LINGXI_SPONSOR_STORE ?? join(dataDir, "sponsored.json"),
        enabled: process.env.LINGXI_SPONSOR === "on" && relayer !== null && chainCtx !== undefined,
        perDay: Number(process.env.LINGXI_SPONSOR_PER_DAY ?? 25),
        // the day's OKB budget for keeping pets (B9), in OKB; 25 pets at the most each may cost unless told
        okbPerDayWei: parseEther(process.env.LINGXI_SPONSOR_OKB_PER_DAY ?? "0.002"),
      });
      if (relayer && chainCtx) sponsoring = { gate, relayer, deployment: chainCtx.deployment, who: clientIp };
    } catch (e) {
      process.stderr.write(`keeping pets without a wallet is off: ${(e as Error).message}\n`);
    }
    withSponsor(app, sponsoring);
  }
  return { sponsorOn };
}
