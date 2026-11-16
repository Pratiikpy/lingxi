/**
 * The start-up self-check (plan 4.11): on every load the page compiles each game rule it runs and compares it with
 * the circuit taped out on X Layer. The result is shown as a mark (all match), a warning (one differs or has no
 * circuit) or nothing claimed (X Layer could not be read).
 */

import { create } from "zustand";
import { type RuleCheck, checkRules, rulesVerdict } from "@lingxi/chain";
import { deployment, publicClient, readClients } from "./chain";

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
    // the page's own endpoint first, then X Layer's other official ones before it is called unreachable
    let checks: RuleCheck[] = [];
    for (const client of [publicClient, ...readClients.filter((c) => c !== publicClient)]) {
      checks = await checkRules(client, deployment.processor, records);
      if (rulesVerdict(checks) !== "unknown") break;
    }
    set({ state: rulesVerdict(checks), checks });
  },
}));
