/**
 * Seasons and their keepsakes (P7: out of server.ts's boot).
 */
/**
 * Lingxi's own small server (web build only): teaching in plain words now;
 * presence, chat and the indexer join it later. The DeWEB build never calls it.
 *
 * The Claude key is read from tapeout/.secrets/anthropic.env (or the
 * ANTHROPIC_API_KEY environment variable) and never leaves this process.
 */

import { join } from "node:path";
import { circuitBrain } from "@lingxi/brain";
import { BrainRelayer } from "../relayer";
import { createNonceBook } from "../relayGate";
import { createSeasonStore, settleAwards } from "../season";
import { parseCard } from "@lingxi/game";
import { type PublicClient } from "viem";
import { type Deployment, createNetlistCache, loadCircuitFromChain, petRegistryAbi, readPet } from "@lingxi/chain";
import { createMindChecker } from "../mindCheck";
import { createStandingsRunner } from "../standings";
import { proveSeasonEntry } from "../seasonProof";
import { createJobs } from "../jobs";
import { type SeasonProver } from "../routes/season";
export { SITE_CACHE_MAX, scriptPolicy, withSite } from "../routes/site";
export { withVoice, withSitting, withArena, withMove, withPush, withMail, withLibrary } from "../routes/play";
export { type SeasonProver, withSeason, type Sponsoring, withSponsor } from "../routes/season";
export { withHistory, withPackets, withTree, withDiaries } from "../routes/chainReads";

import type { KeeperCheck } from "../server";

/**
 * Seasons: standings fought in a worker thread with a time budget (A38), and the proof that an entry is a pet on
 * X Layer.
 */
export function createSeasons({
  chainCtx,
  visitorPub,
  dataDir,
  isKeeper,
}: {
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  visitorPub: PublicClient;
  dataDir: string;
  isKeeper: KeeperCheck | undefined;
}) {
  // standings fought in a worker thread with a time budget, kept on disk (A38)
  const seasons = createSeasonStore(
    process.env.LINGXI_SEASON_STORE,
    Date.now,
    createStandingsRunner({ file: process.env.LINGXI_STANDINGS_FILE ?? join(dataDir, "standings.json") }),
  );
  // proving an entry is a pet on X Layer: its keeper's signature, and its card thinks as its brain on chain does
  const seasonNonces = createNonceBook();
  const mindChecker = createMindChecker();
  // netlists a season proof has read; a taped-out netlist never changes (A115)
  const seasonNetlists = createNetlistCache();
  const prove: SeasonProver | undefined =
    chainCtx && isKeeper
      ? (pet, proof) =>
          proveSeasonEntry(pet, proof, {
            isKeeper,
            now: Date.now,
            nonces: seasonNonces,
            // a proven entry's brain is read through the visitors' client, at most MAX_CIRCUIT_READS circuits, each
            // netlist read once for the whole server (A115)
            brainOf: async (id) => {
              const onChain = await readPet(visitorPub, chainCtx!.deployment, BigInt(id));
              const circuit = await loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, {
                cache: seasonNetlists,
              });
              return { fast: circuitBrain(circuit), nState: circuit.nState };
            },
            // the comparison itself runs off the request thread, with a budget (A62)
            circuitOf: async (id) => {
              const onChain = await readPet(visitorPub, chainCtx!.deployment, BigInt(id));
              return loadCircuitFromChain(visitorPub, onChain.processor, onChain.brainId, undefined, {
                cache: seasonNetlists,
              });
            },
            check: mindChecker,
          })
      : undefined;
  return { seasons, prove };
}

/**
 * A finished week's best-placed proven pet gets its brain taped out and sent to its owner's wallet (PRD F26).
 */
export function startKeepsakes({
  jobs,
  chainCtx,
  relayer,
  seasons,
}: {
  jobs: ReturnType<typeof createJobs>;
  chainCtx: { pub: PublicClient; deployment: Deployment } | undefined;
  relayer: BrainRelayer | null;
  seasons: ReturnType<typeof createSeasonStore>;
}) {
  if (relayer) {
    // a finished week's best-placed proven pet gets its brain taped out and sent to its owner's wallet (PRD F26)
    const giveKeepsakes = () =>
      settleAwards(seasons, async (entry, petId) => {
        const card = parseCard(entry.pet.card);
        if (!card) return { ok: false, detail: "damaged card" };
        // the keepsake goes to whoever owns the proven pet now, read on chain at the moment it is sent
        if (!chainCtx) return { ok: false, detail: "no chain reads" };
        const to = (await chainCtx.pub.readContract({
          address: chainCtx.deployment.registry,
          abi: petRegistryAbi,
          functionName: "ownerOf",
          args: [BigInt(petId)],
        })) as `0x${string}`;
        const r = await relayer.keepsake(
          {
            line: entry.pet.line,
            lessons: card.lessons,
            instincts: card.instincts,
            family: card.family,
            growth: card.growth,
          },
          to,
        );
        if (!r.ok) process.stderr.write(`season keepsake failed: ${r.reason} ${r.detail ?? ""}\n`);
        return r.ok
          ? { ok: true, brainId: r.brainId, to, tapeTx: r.tapeTx, sendTx: r.sendTx }
          : { ok: false, detail: r.detail };
      });
    jobs.after("season keepsakes (first)", 30_000, giveKeepsakes);
    jobs.every("season keepsakes", 10 * 60_000, giveKeepsakes);
  }
}
