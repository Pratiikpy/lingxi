/**
 * The chain store's actions for keeping a pet on X Layer: with the player's wallet, for free with this device's key (H4), and
 * moving a pet kept for free to a wallet (P7: out of chain.ts, which composes them).
 */
import { type Hex } from "viem";
import {
  petRegistryAbi,
  type Deployment,
  hatchOnChain,
  readPet,
  setBrainOnChain,
  StillPending,
  hatchOutcome,
} from "@lingxi/chain";
import { AUTO_LOW, sessionAccount, sessionWallet } from "./session";
import { type Pet, packState, restartLog, stageOf, ruleSkillIds } from "@lingxi/game";
import type { BrainRelayPayload } from "@lingxi/api-schema";
import { relayAvailable, relayBrain, signRelayRequest } from "./api";
import { useGame } from "./store";
import { now as gameNow } from "./gameClock";
import {
  type ChainRecord,
  mindKey,
  petKey,
  records,
  store,
  PENDING_FORGET_MS,
  pending,
  setPending,
  activeRecord,
} from "./chainRecords";
import { chainReason } from "./chainRefusals";
import { connectWallet, API_BASE, askToKeep, keptFor, relaySigner, accountOf, starterId } from "./chainHelpers";
import type { StoreApi } from "zustand";
import type { ChainState } from "./chain";

import { chain, deployment as networkDeployment, publicClient, rpc } from "./network";
// a module constant of its own, so a check for it narrows it inside the closures below
const deployment: Deployment | undefined = networkDeployment;
/** How often a hatch sent and not yet confirmed is asked about (P7a). */
const FOLLOW_MS = 15_000;
/** The pending hatches being watched, by pet. */
const following = new Map<string, ReturnType<typeof setInterval>>();

export function keepActions(
  set: StoreApi<ChainState>["setState"],
  get: () => ChainState,
): Pick<ChainState, "checkFree" | "keepFree" | "moveToWallet" | "keep"> {
  /** A pet's record from its mined hatch: kept, its log restarted where the hatch took its state, the pending entry
   * cleared, and the panel showing it as kept. */
  const recordFrom = async (
    pet: Pet,
    petId: bigint,
    tx: Hex,
    owner: string,
    start?: { n?: number; memory?: number[] },
  ): Promise<ChainRecord> => {
    if (!deployment) throw new Error("no deployment to read the pet from");
    const onChain = await readPet(publicClient, deployment, petId);
    const rec: ChainRecord = {
      petId: petId.toString(),
      hatchTx: tx,
      lastDay: 0,
      owner,
      bornChain: onChain.born,
      brains: { [mindKey([])]: starterId(deployment, pet.line) },
      brainKey: mindKey([]),
    };
    store(pet, rec);
    // its log now starts where the hatch took its state, which is where the chain's proof of its memory starts (A66)
    const n = start?.n;
    const memory = start?.memory;
    if (n !== undefined && memory) useGame.getState().rework(pet.bornAt, (p) => restartLog(p, n, memory));
    setPending(pet, null);
    // from here on the panel shows the pet as kept, whatever fails after
    set({ record: activeRecord() });
    return rec;
  };

  /**
   * P7a: a hatch sent and not confirmed within the wait is watched until it lands, for as long as a pending hatch is
   * waited for (PENDING_FORGET_MS), and taken up by itself when it does: no second press and no wallet asked. A hatch
   * that failed, or that the chain never tells of, is left for the player's next press, which says what happened.
   */
  const follow = (pet: Pet) => {
    const k = petKey(pet);
    if (following.has(k)) return;
    const stop = () => {
      clearInterval(following.get(k));
      following.delete(k);
    };
    // R18: one question at a time. On a slow chain an answer can take longer than the wait between questions; a
    // second one asked meanwhile could come back as well, and both would record the same hatch.
    let asking = false;
    following.set(
      k,
      setInterval(() => {
        const sent = pending[k];
        if (records[k] || !sent || !deployment) return stop();
        if (Date.now() - sent.at > PENDING_FORGET_MS) return stop();
        // the player's own keep under way takes it up itself
        if (get().busy !== "idle") return;
        if (asking) return;
        asking = true;
        void hatchOutcome(publicClient, deployment, sent.tx, sent.owner as Hex)
          // a check X Layer could not answer is asked again at the next tick
          .catch(() => "unchecked" as const)
          .then(async (out) => {
            if (typeof out !== "object") {
              if (out === "failed") stop();
              return;
            }
            stop();
            // the pet as it is now, not as it was when the keep began
            const now = useGame.getState().pets.find((x) => petKey(x) === k) ?? pet;
            if (records[k]) return;
            await recordFrom(now, out.petId, sent.tx, sent.owner, sent);
            const shown = get().error;
            if (shown === "hatchPending" || shown === "hatchUnchecked") set({ error: null });
          })
          .catch(() => {
            // the pet could not be read back yet: the next press reads it again, the hatch is not sent twice
          })
          .finally(() => {
            asking = false;
          });
      }, FOLLOW_MS),
    );
  };
  return {
    checkFree: async () => {
      // the on-chain copy has no server, so nothing is kept for free there
      if (!API_BASE || !deployment) return set({ freeOn: false });
      try {
        const r = (await (await fetch(`${API_BASE}/api/sponsor`)).json()) as { ok?: boolean; on?: boolean };
        set({ freeOn: r.ok === true && r.on === true });
      } catch {
        set({ freeOn: false });
      }
    },
    keepFree: async (pet) => {
      if (!deployment) return set({ error: "notDeployed" });
      if (get().busy !== "idle" || pet.family) return;
      set({ busy: "hatching", error: null });
      try {
        const key = await sessionAccount();
        let record = records[petKey(pet)] ?? null;
        // the state the hatch records and the log's length at that moment, taken together from the same pet
        const start = { n: pet.pendingLog.length, memory: pet.brain.slice() };
        const asked = await askToKeep(key, pet);
        if (!asked.ok) {
          // an answer lost on the way: the server remembers this key's pet, and X Layer says whose it is
          if (asked.reason !== "had" || record)
            return set({ busy: "idle", error: `free.${asked.reason}`, record: activeRecord() });
        }
        const known = asked.ok && asked.petId && asked.hatchTx ? asked : await keptFor(key.address);
        if (!record) {
          if (!known?.petId || !known.hatchTx) return set({ busy: "idle", error: "free.error" });
          // the chain's word, never the server's: the pet must be this device's
          const onChain = await readPet(publicClient, deployment, BigInt(known.petId));
          if (onChain.owner.toLowerCase() !== key.address.toLowerCase())
            return set({ busy: "idle", error: "free.notOurs" });
          record = {
            petId: known.petId,
            hatchTx: known.hatchTx,
            lastDay: 0,
            owner: key.address,
            bornChain: onChain.born,
            brains: { [mindKey([])]: starterId(deployment, pet.line) },
            brainKey: mindKey([]),
            device: true,
          };
          store(pet, record);
          // its log now starts where the hatch took its state, which is where the chain's proof of its memory starts (A66)
          if (asked.ok) useGame.getState().rework(pet.bornAt, (p) => restartLog(p, start.n, start.memory));
          set({ record: activeRecord() });
        }
        const gas = await publicClient.getBalance({ address: key.address });
        if (gas < AUTO_LOW) return set({ busy: "idle", error: "free.noGas", record: activeRecord() });
        // a pet with instincts moves onto its own circuit, signed and paid by this device's key
        const mind = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
        if (pet.instincts && relayAvailable() && record.brainKey !== mind) {
          set({ busy: "taping" });
          const body: BrainRelayPayload = {
            line: pet.line,
            lessons: pet.lessons,
            instincts: pet.instincts,
            skills: ruleSkillIds(pet.growth),
          };
          const r = await relayBrain(await signRelayRequest(key, "brain", record.petId, body));
          if (!r.ok) throw new Error(r.reason);
          set({ busy: "saving" });
          await setBrainOnChain(
            publicClient,
            await sessionWallet(chain, rpc),
            deployment,
            BigInt(record.petId),
            deployment.processor,
            BigInt(r.brainId),
          );
          store(pet, { ...record, brains: { ...record.brains, [mind]: r.brainId }, brainKey: mind });
        }
        set({ record: activeRecord(), busy: "idle" });
      } catch (e) {
        set({ busy: "idle", error: chainReason(e), record: activeRecord() });
      }
    },
    moveToWallet: async (pet) => {
      const r = records[petKey(pet)];
      if (!deployment || !r?.device || get().busy !== "idle") return false;
      set({ busy: "connecting", error: null });
      try {
        const to = accountOf(await connectWallet()).address;
        set({ busy: "saving" });
        const key = await sessionAccount();
        // a plain transfer from this device's key: the wallet signs nothing and pays nothing
        const { request } = await publicClient.simulateContract({
          address: deployment.registry,
          abi: petRegistryAbi,
          functionName: "transferFrom",
          args: [key.address, to, BigInt(r.petId)],
          account: key,
        });
        const tx = await (await sessionWallet(chain, rpc)).writeContract(request);
        const mined = await publicClient.waitForTransactionReceipt({ hash: tx });
        if (mined.status !== "success") throw new Error("the move was turned down on chain");
        const { device: _device, ...rest } = r;
        store(pet, { ...rest, owner: to, lastTx: tx });
        set({ busy: "idle", record: activeRecord() });
        return true;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return false;
      }
    },
    keep: async (pet) => {
      if (!deployment) return set({ error: "notDeployed" });
      // a second press while a keep is under way does nothing: one pet, one hatch (A20)
      if (get().busy !== "idle") return;
      set({ busy: "connecting", error: null });
      try {
        // a pet this device has kept already is never hatched again; keeping it again finishes what is left (A20)
        let record = records[petKey(pet)] ?? null;
        // a hatch sent before and not yet confirmed is asked about first, never sent again (A30)
        const sent = record ? null : (pending[petKey(pet)] ?? null);
        if (sent) {
          set({ busy: "hatching" });
          // a check X Layer could not answer is never taken for a hatch that was not sent (A82)
          const out = await hatchOutcome(publicClient, deployment, sent.tx, sent.owner as Hex).catch(
            () => "unchecked" as const,
          );
          if (out === "unchecked") {
            follow(pet);
            return set({ busy: "idle", error: "hatchUnchecked" });
          }
          if (out === "pending" || (out === "unknown" && Date.now() - sent.at < PENDING_FORGET_MS)) {
            follow(pet);
            return set({ busy: "idle", error: "hatchPending" });
          }
          if (typeof out === "object") record = await recordFrom(pet, out.petId, sent.tx, sent.owner, sent);
          else setPending(pet, null);
        }
        const wallet = await connectWallet();
        if (!record) {
          set({ busy: "hatching" });
          const owner = accountOf(wallet).address;
          // the state the hatch records and the log's length at that moment, taken together from the same pet
          const start = { n: pet.pendingLog.length, memory: pet.brain.slice() };
          const { petId, tx } = await hatchOnChain(
            publicClient,
            wallet,
            deployment,
            pet.line,
            packState(pet, stageOf(pet, gameNow())),
            (tx) => setPending(pet, { tx, owner, at: Date.now(), ...start }),
          );
          record = await recordFrom(pet, petId, tx, owner, start);
        }
        // the registry hatches every pet on its line's starter brain; a pet with
        // instincts moves straight onto its own circuit before anything is saved
        const key = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
        if (pet.instincts && relayAvailable() && record.brainKey !== key) {
          set({ busy: "taping" });
          const body: BrainRelayPayload = {
            line: pet.line,
            lessons: pet.lessons,
            instincts: pet.instincts,
            skills: ruleSkillIds(pet.growth),
          };
          const r = await relayBrain(
            await signRelayRequest(await relaySigner(record.petId, wallet), "brain", record.petId, body),
          );
          if (!r.ok) throw new Error(r.reason);
          set({ busy: "saving" });
          await setBrainOnChain(
            publicClient,
            wallet,
            deployment,
            BigInt(record.petId),
            deployment.processor,
            BigInt(r.brainId),
          );
          store(pet, { ...record, brains: { ...record.brains, [key]: r.brainId }, brainKey: key });
        }
        set({ record: activeRecord(), busy: "idle" });
      } catch (e) {
        // an address whose code refuses tokens is told so (A13), a contract's own reason is said (A19); a hatch that
        // landed before the failure stays shown as kept (A20); one sent and not yet confirmed is said so (A30)
        if (e instanceof StillPending) follow(pet);
        set({
          busy: "idle",
          error: e instanceof StillPending ? "hatchPending" : chainReason(e),
          record: activeRecord(),
        });
      }
    },
  };
}
