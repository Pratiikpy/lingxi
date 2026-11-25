/**
 * The chain store's actions for the pet's own mind on X Layer: taping it out with the player's wallet or through the
 * relayer, and its log (P7: out of chain.ts, which composes them).
 */
import { type Deployment, quoteTapeout, setBrainOnChain, tapeOutYourself } from "@lingxi/chain";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { logSegments, petCard, ruleSkillIds } from "@lingxi/game";
import { relayBrain, relayChild, relayInstinct, signRelayRequest } from "./api";
import { diaryBody } from "./requests";
import { programFor } from "./store";
import { mindKey, petKey, records, store, activeRecord } from "./chainRecords";
import { chainReason } from "./chainRefusals";
import { connectWallet, relaySigner } from "./chainHelpers";
import type { StoreApi } from "zustand";
import type { ChainState } from "./chain";

import { deployment as networkDeployment, publicClient } from "./network";
// a module constant of its own, so a check for it narrows it inside the closures below
const deployment: Deployment | undefined = networkDeployment;

export function mindActions(
  set: StoreApi<ChainState>["setState"],
): Pick<ChainState, "quoteSelf" | "selfTape" | "updateMind" | "exportLog"> {
  return {
    quoteSelf: async (pet) => {
      if (!deployment || pet.family) return null;
      set({ busy: "connecting", error: null });
      try {
        const wallet = await connectWallet();
        const net = compileProgram(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth));
        const q = await quoteTapeout(
          publicClient,
          deployment.processor,
          wallet.account!.address,
          net.gates.length,
          net.latches.length,
          netlistBytes(net).length,
        );
        set({ busy: "idle" });
        return q;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return null;
      }
    },
    selfTape: async (pet, q, onStep) => {
      const record = records[petKey(pet)];
      if (!deployment || !record || pet.family) return false;
      set({ busy: "taping", error: null });
      try {
        const wallet = await connectWallet();
        const bytes = netlistBytes(compileProgram(programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth)));
        const { brainId } = await tapeOutYourself(publicClient, wallet, deployment.processor, bytes, q, onStep);
        onStep("setBrain");
        set({ busy: "saving" });
        await setBrainOnChain(publicClient, wallet, deployment, BigInt(record.petId), deployment.processor, brainId);
        const key = mindKey(pet.lessons, pet.instincts);
        store(pet, { ...record, brains: { ...(record.brains ?? {}), [key]: brainId.toString() }, brainKey: key });
        set({ record: activeRecord(), busy: "idle" });
        return true;
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
        return false;
      }
    },
    updateMind: async (pet) => {
      const record = records[petKey(pet)];
      if (!deployment || !record) return;
      set({ busy: "connecting", error: null });
      try {
        const key = mindKey(pet.lessons, pet.instincts, pet.outside, ruleSkillIds(pet.growth));
        let brainId = record.brains?.[key];
        if (!brainId) {
          set({ busy: "taping" });
          // a child's mind is both halves, REF'd by a new child circuit
          const { outside: _o, ...plain } = pet;
          const ownKey = mindKey(pet.lessons, pet.instincts, undefined, ruleSkillIds(pet.growth));
          let ownId = record.brains?.[ownKey];
          if (!ownId) {
            const signer = await relaySigner(record.petId);
            const r = pet.family
              ? await relayChild(await signRelayRequest(signer, "child", record.petId, { card: petCard(plain) }))
              : await relayBrain(
                  await signRelayRequest(signer, "brain", record.petId, {
                    line: pet.line,
                    lessons: pet.lessons,
                    ...(pet.instincts ? { instincts: pet.instincts } : {}),
                    skills: ruleSkillIds(pet.growth),
                  }),
                );
            if (!r.ok) throw new Error(r.reason);
            ownId = r.brainId;
          }
          brainId = ownId;
          // an owned instinct: a circuit that REFs the pet's own brain and the owned one
          if (pet.outside) {
            const r = await relayInstinct(
              await signRelayRequest(await relaySigner(record.petId), "instinct", record.petId, {
                own: ownId,
                processor: pet.outside.processor,
                id: pet.outside.id,
              }),
            );
            if (!r.ok) throw new Error(r.reason);
            brainId = r.brainId;
          }
        }
        const wallet = await connectWallet();
        set({ busy: "saving" });
        await setBrainOnChain(
          publicClient,
          wallet,
          deployment,
          BigInt(record.petId),
          deployment.processor,
          BigInt(brainId),
        );
        const next = { ...record, brains: { ...(record.brains ?? {}), [key]: brainId }, brainKey: key };
        store(pet, next);
        set({ record: activeRecord(), busy: "idle" });
      } catch (e) {
        set({ busy: "idle", error: chainReason(e) });
      }
    },
    exportLog: (pet) => {
      const record = records[petKey(pet)];
      if (!record) return null;
      // the log exactly as the last checkpoint committed it
      const n = record.logLen ?? 0;
      const segments = logSegments({ ...pet, pendingLog: pet.pendingLog.slice(0, n) })
        .map((s) => ({
          brainId: record.brains?.[mindKey(s.lessons, pet.instincts, s.outside, s.skills)] ?? null,
          words: s.words,
        }))
        .filter((s) => s.words.length > 0);
      return JSON.stringify(diaryBody(record.petId, pet.pendingLog.slice(0, n), segments));
    },
  };
}
