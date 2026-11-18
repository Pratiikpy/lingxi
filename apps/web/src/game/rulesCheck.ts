/**
 * The start-up self-check (plan 4.11): on every load the page compiles each game rule it runs and compares it with
 * the circuit taped out on X Layer. The result is shown as a mark (all match), a warning (one differs or has no
 * circuit) or nothing claimed (X Layer could not be read).
 */

import { create } from "zustand";
import { type RuleCheck, checkRules, rulesVerdict } from "@lingxi/chain";
import { deployment } from "./chain";
import { proofClient } from "./proofRpc";

export type RulesState = "idle" | "checking" | "verified" | "broken" | "unknown" | "notTaped";

interface RulesCheckStore {
  state: RulesState;
  checks: RuleCheck[];
  run: () => Promise<void>;
}

export const useRulesCheck = create<RulesCheckStore>((set, get) => ({
  state: "idle",
  checks: [],
  run: async () => {
    if (get().state === "checking") return;
    const records = deployment?.rules;
    // a build with no rules on record (a local test chain) claims nothing either way
    if (!deployment || !records) return set({ state: "notTaped", checks: [] });
    set({ state: "checking" });
    // a claim of verification, so it reads X Layer the way the proof page does: public RPCs first, each one in turn
    const checks: RuleCheck[] = await checkRules(proofClient(), deployment.processor, records);
    set({ state: rulesVerdict(checks), checks });
  },
}));
