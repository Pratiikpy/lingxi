/**
 * The chain store's actions for families on X Layer: the partner a pet may breed with, the consents given and withdrawn,
 * breeding, and births finished after a reload (P7: out of chain.ts, which composes them).
 */
import { erc20Abi, isAddress, type Address, type Hex } from "viem";
import {
  type Deployment,
  allowPartnerOnChain,
  consentStands,
  withdrawConsentOnChain,
  breedOnChain,
  breedingTerms,
  checkPartner,
  hasConsent,
  refusesTokens,
  StillPending,
  birthOutcome,
  revertName,
  breederV2Abi,
} from "@lingxi/chain";
import { type Pet } from "@lingxi/game";
import { relayChild, signRelayRequest } from "./api";
import { firstLine } from "./errorText";
import {
  LINES,
  petKey,
  records,
  store,
  PENDING_FORGET_MS,
  births,
  setBirth,
  type GivenConsent,
  given,
  setGiven,
  sameConsent,
  activeRecord,
} from "./chainRecords";
import { chainReason, BREED_REFUSALS } from "./chainRefusals";
import {
  connectWallet,
  breedersHere,
  API_BASE,
  INDEX_BEHIND_OK,
  birthRecord,
  relaySigner,
  saveFirstDay,
} from "./chainHelpers";
import type { StoreApi } from "zustand";
import type { ChainState } from "./chain";

import { deployment as networkDeployment, publicClient } from "./network";
// a module constant of its own, so a check for it narrows it inside the closures below
const deployment: Deployment | undefined = networkDeployment;

export function familyActions(
  set: StoreApi<ChainState>["setState"],
): Pick<ChainState, "infoOf" | "allow" | "consentsOf" | "withdraw" | "finishBirths" | "breed"> {
  return {
    infoOf: (pet) => {
      const r = records[petKey(pet)];
      const brain = r?.brains?.[r.brainKey ?? ""];
      return r && brain && deployment?.breeder ? { petId: r.petId, owner: r.owner, brain } : null;
    },
    allow: async (pet, partnerOwner) => {
      const r = records[petKey(pet)];
      if (!deployment?.breeder || !r) return false;
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        set({ busy: "saving" });
        await allowPartnerOnChain(publicClient, wallet, deployment, BigInt(r.petId), partnerOwner as Hex);
        const c = { breeder: deployment.breeder, partner: partnerOwner as Address };
        const held = given[petKey(pet)] ?? [];
        if (!held.some((x) => sameConsent(x, c))) setGiven(petKey(pet), [...held, c]);
        set({ busy: "idle" });
        return true;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return false;
      }
    },
    consentsOf: async (pet) => {
      const r = records[petKey(pet)];
      if (!deployment || !r) return { consents: [], partial: false };
      const known = breedersHere().map((a) => a.toLowerCase());
      const candidates: GivenConsent[] = [...(given[petKey(pet)] ?? [])];
      let partial = true;
      try {
        const res = await fetch(`${API_BASE}/api/consents/${r.petId}`);
        const body = (await res.json()) as {
          ok: boolean;
          indexedTo?: number;
          consents?: Array<{ breeder: string; partner: string }>;
        };
        if (body.ok && Array.isArray(body.consents)) {
          for (const c of body.consents) {
            if (!known.includes(c.breeder.toLowerCase()) || !isAddress(c.partner)) continue;
            const x = { breeder: c.breeder as Address, partner: c.partner as Address };
            if (!candidates.some((y) => sameConsent(x, y))) candidates.push(x);
          }
          const head = Number(await publicClient.getBlockNumber());
          partial = typeof body.indexedTo !== "number" || head - body.indexedTo > INDEX_BEHIND_OK;
        }
      } catch {
        // the server's list is only a help: the consents this device gave are still checked below
      }
      try {
        const standing = await Promise.all(
          candidates.map((c) => consentStands(publicClient, c.breeder, BigInt(r.petId), c.partner)),
        );
        const consents = candidates.filter((_, i) => standing[i]);
        // one this device gave that no longer stands (used, withdrawn, the pet sold) is forgotten
        setGiven(
          petKey(pet),
          (given[petKey(pet)] ?? []).filter((x) => consents.some((y) => sameConsent(x, y))),
        );
        return { consents, partial };
      } catch {
        return null;
      }
    },
    withdraw: async (pet, c) => {
      const r = records[petKey(pet)];
      if (!deployment || !r || !breedersHere().some((a) => a.toLowerCase() === c.breeder.toLowerCase())) return false;
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        set({ busy: "saving" });
        await withdrawConsentOnChain(publicClient, wallet, c.breeder, BigInt(r.petId), c.partner);
        setGiven(
          petKey(pet),
          (given[petKey(pet)] ?? []).filter((x) => !sameConsent(x, c)),
        );
        set({ busy: "idle" });
        return true;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return false;
      }
    },
    finishBirths: async () => {
      const out: Array<{ child: Pet; memory: number[] }> = [];
      if (!deployment) return out;
      for (const [parentKey, b] of Object.entries(births)) {
        try {
          const o = await birthOutcome(publicClient, b.tx);
          if (typeof o === "object") {
            const { record, memory } = await birthRecord(o.childId, b.tx, b.owner, b.brainId);
            store(b.child, record);
            setBirth(parentKey, null);
            out.push({
              child: { ...b.child, brain: memory.length === b.child.brain.length ? memory : b.child.brain },
              memory,
            });
          } else if (o === "failed" || (o === "unknown" && Date.now() - b.at >= PENDING_FORGET_MS))
            setBirth(parentKey, null);
        } catch {
          // the node did not answer: asked again next time
        }
      }
      return out;
    },
    breed: async (parent, partner, child) => {
      const r = records[petKey(parent)];
      const mine = r?.brains?.[r.brainKey ?? ""];
      if (!deployment?.breeder || !r || !mine) return { ok: false, reason: "offChain" };
      set({ busy: "connecting", error: null });
      try {
        // a birth sent before and not yet recorded is asked about first, never sent again (A48)
        const sentBefore = births[petKey(parent)] ?? null;
        if (sentBefore) {
          set({ busy: "hatching" });
          // a check X Layer could not answer is never taken for a birth that was not sent (A82)
          const out = await birthOutcome(publicClient, sentBefore.tx).catch(() => "unchecked" as const);
          if (out === "unchecked") {
            set({ busy: "idle", error: "birthUnchecked" });
            return { ok: false, reason: "birthUnchecked" };
          }
          if (out === "pending" || (out === "unknown" && Date.now() - sentBefore.at < PENDING_FORGET_MS)) {
            set({ busy: "idle", error: "birthPending" });
            return { ok: false, reason: "birthPending" };
          }
          if (typeof out === "object") {
            const { record: born, memory } = await birthRecord(
              out.childId,
              sentBefore.tx,
              sentBefore.owner,
              sentBefore.brainId,
            );
            store(child, born);
            setBirth(petKey(parent), null);
            set({ busy: "saving" });
            const firstDay = await saveFirstDay(await connectWallet(), born, { ...child, brain: memory });
            set({ busy: "idle", record: activeRecord() });
            return { ok: true, memory, firstDay };
          }
          setBirth(petKey(parent), null);
        }
        // the wallet and the fee come first: a child circuit is taped out only for a birth that can go through
        const wallet = await connectWallet();
        const terms = await breedingTerms(publicClient, deployment, [BigInt(r.petId), BigInt(partner.petId)]);
        if (terms) {
          if (terms.childrenLeft.some((n) => n <= 0)) throw new Error("TooManyChildren");
          const held = (await publicClient.readContract({
            address: terms.bem,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [wallet.account!.address],
          })) as bigint;
          if (held < terms.fee) throw new Error("not enough BEM");
        }
        // the partner's pet, owner and brain as they told us are checked on chain, and its consent must stand, before
        // the child circuit is taped out: nothing is spent on a partner's word alone
        if ((await checkPartner(publicClient, deployment, partner)) !== "ok") throw new Error("PartnerNotOnChain");
        if (!(await hasConsent(publicClient, deployment, BigInt(partner.petId), wallet.account!.address)))
          throw new Error("NoConsent");
        set({ busy: "taping" });
        const relayed = await relayChild(
          await signRelayRequest(await relaySigner(r.petId, wallet), "child", r.petId, {
            parents: [mine, partner.brain],
          }),
        );
        if (!relayed.ok) throw new Error(relayed.reason);
        set({ busy: "hatching" });
        const owner = wallet.account!.address;
        const { childId, tx } = await breedOnChain(
          publicClient,
          wallet,
          deployment,
          BigInt(r.petId),
          BigInt(partner.petId),
          deployment.processor,
          BigInt(relayed.brainId),
          LINES.indexOf(child.line),
          (sent) => setBirth(petKey(parent), { tx: sent, owner, at: Date.now(), brainId: relayed.brainId, child }),
        );
        const { record: born, memory } = await birthRecord(childId, tx, owner, relayed.brainId);
        store(child, born);
        setBirth(petKey(parent), null);
        set({ busy: "saving" });
        const firstDay = await saveFirstDay(wallet, born, { ...child, brain: memory });
        set({ busy: "idle", record: activeRecord() });
        return { ok: true, memory, firstDay };
      } catch (e) {
        // sent and not yet confirmed: kept, and asked about when Welcome is pressed again (A48)
        if (e instanceof StillPending) {
          set({ busy: "idle", error: "birthPending" });
          return { ok: false, reason: "birthPending" };
        }
        const msg = firstLine(e);
        set({ busy: "idle", error: msg });
        // the Breeder's own reason, read from the decoded error, not the message's first line (A19)
        const refused = revertName(e, breederV2Abi);
        return {
          ok: false,
          reason: refusesTokens(e)
            ? "cannotReceive"
            : refused && refused in BREED_REFUSALS
              ? BREED_REFUSALS[refused]!
              : /PartnerNotOnChain/.test(msg)
                ? "partnerNotOnChain"
                : /not enough BEM/.test(msg)
                  ? "notEnoughBem"
                  : msg,
        };
      }
    },
  };
}
