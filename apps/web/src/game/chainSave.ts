/**
 * The chain store's actions for saving the day on X Layer: by hand, automatically with the device's key, and a friend
 * sitting a pet (P7: out of chain.ts, which composes them).
 */
import { useBadges } from "./badges";
import { isAddress, type Hex } from "viem";
import { type Deployment, checkpointOnChain, setSitterOnChain } from "@lingxi/chain";
import { AUTO_DAYS, AUTO_FUND, sessionAccount } from "./session";
import { packState, stageOf } from "@lingxi/game";
import { noteTally } from "./tally";
import { now as gameNow } from "./gameClock";
import { chainDay, petKey, records, store, activeRecord } from "./chainRecords";
import { chainReason } from "./chainRefusals";
import { connectWallet, autoWallet } from "./chainHelpers";
import type { StoreApi } from "zustand";
import type { ChainState } from "./chain";

import { chain, deployment as networkDeployment, publicClient } from "./network";
// a module constant of its own, so a check for it narrows it inside the closures below
const deployment: Deployment | undefined = networkDeployment;

export function saveActions(
  set: StoreApi<ChainState>["setState"],
  get: () => ChainState,
): Pick<ChainState, "saveToday" | "enableAuto" | "endSitting" | "sitWith"> {
  return {
    saveToday: async (pet, onSaved, quiet = false) => {
      const record = records[petKey(pet)];
      // a pet away (with a friend, or waiting at the adoption centre, whose offer fixes its saved record) is not saved
      if (!deployment || !record || get().busy !== "idle" || pet.away) return;
      set({ busy: quiet ? "auto" : "connecting", error: null });
      try {
        const auto = await autoWallet(pet, record, () => set({ record: activeRecord() }));
        if (!auto && quiet) return set({ busy: "idle" });
        const wallet = auto ?? (await connectWallet());
        set({ busy: quiet ? "auto" : "saving" });
        // days are counted the way PetRegistry counts them: from block time, not this computer's clock
        const blockMs = Number((await publicClient.getBlock()).timestamp) * 1000;
        const day = chainDay(record, blockMs);
        if (day <= record.lastDay) {
          set({ busy: "idle", error: quiet ? null : "alreadySaved" });
          return;
        }
        const tx = await checkpointOnChain(
          publicClient,
          wallet,
          deployment,
          BigInt(record.petId),
          day,
          packState(pet, stageOf(pet, gameNow())),
          pet.logHash as Hex,
        );
        const next = { ...(records[petKey(pet)] ?? record), lastDay: day, lastTx: tx, logLen: pet.pendingLog.length };
        store(pet, next);
        set({ record: activeRecord(), busy: "idle" });
        useBadges.getState().note("chainDays");
        noteTally("SAVE");
        onSaved();
      } catch (e) {
        // a state of another line is never written over a pet (A18), and a refusal says the registry's reason (A19)
        set({ busy: "idle", error: quiet ? null : chainReason(e) });
      }
    },
    enableAuto: async (pet) => {
      const record = records[petKey(pet)];
      if (!deployment || !record) return;
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        set({ busy: "saving" });
        const key = (await sessionAccount()).address;
        const now = Number((await publicClient.getBlock()).timestamp);
        // a little under the contract's 30-day limit, so the block that includes it is never past it
        const until = now + AUTO_DAYS * 86_400 - 600;
        await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), key, BigInt(until));
        const balance = await publicClient.getBalance({ address: key });
        if (balance < AUTO_FUND / 2n) {
          const tx = await wallet.sendTransaction({
            to: key,
            value: AUTO_FUND - balance,
            account: wallet.account!,
            chain,
          });
          await publicClient.waitForTransactionReceipt({ hash: tx });
        }
        store(pet, { ...record, autoUntil: until, sitter: undefined });
        set({ record: activeRecord(), busy: "idle" });
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
      }
    },
    endSitting: async (pet) => {
      const record = records[petKey(pet)];
      if (!deployment || !record) return;
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        set({ busy: "saving" });
        await setSitterOnChain(
          publicClient,
          wallet,
          deployment,
          BigInt(record.petId),
          "0x0000000000000000000000000000000000000000",
          0n,
        );
        store(pet, { ...record, autoUntil: undefined, sitter: undefined });
        set({ record: activeRecord(), busy: "idle" });
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
      }
    },
    sitWith: async (pet, who, days) => {
      const record = records[petKey(pet)];
      if (!deployment || !record) return false;
      if (!isAddress(who)) {
        set({ error: "badAddress" });
        return false;
      }
      if (!(days >= 1 && days <= 30)) {
        set({ error: "badDays" });
        return false;
      }
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        if (who.toLowerCase() === wallet.account!.address.toLowerCase()) throw new Error("selfSitter");
        set({ busy: "saving" });
        const now = Number((await publicClient.getBlock()).timestamp);
        const until = now + Math.round(days) * 86_400 - 600;
        await setSitterOnChain(publicClient, wallet, deployment, BigInt(record.petId), who as Hex, BigInt(until));
        store(pet, { ...record, autoUntil: undefined, sitter: { who, until } });
        set({ record: activeRecord(), busy: "idle" });
        return true;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return false;
      }
    },
  };
}
