/**
 * Every game rule taped out as a circuit (plan 4.11), and the start-up check that each one the page compiles is
 * byte for byte the netlist stored on Lingxi's processor on X Layer.
 */

import { type RuleCircuit, bytesToHex, gateCount, ruleBytes, ruleNetlist } from "@lingxi/brain";
import { BUILDER_RULES, SKILL_RULE } from "@lingxi/game";
import { DROP_RULE, FOLK_RULES, TRUST_RULE } from "@lingxi/world";
import type { Address, Hex, PublicClient } from "viem";
import { processorAbi } from "./tapeout";

export const RULES: readonly RuleCircuit[] = [DROP_RULE, TRUST_RULE, SKILL_RULE, ...FOLK_RULES, ...BUILDER_RULES];

/** Where a rule was taped out: its circuit id on the processor, the transaction and its size. */
export interface RuleRecord {
  id: string;
  tx: string;
  gates: number;
}

export type RuleStatus = "match" | "differs" | "missing" | "unreachable";

export interface RuleCheck {
  name: string;
  id: string | null;
  status: RuleStatus;
  gates: number;
}

export const ruleHex = (rule: RuleCircuit): Hex => bytesToHex(ruleBytes(rule)) as Hex;
export const ruleGates = (rule: RuleCircuit): number => gateCount(ruleNetlist(rule));

/**
 * Compile every rule here and read each circuit back from the processor. `missing` means a rule this page runs has no
 * circuit on record; `differs` means the rule here is not the one taped out; `unreachable` means X Layer could not be
 * read, which says nothing either way.
 */
export async function checkRules(pub: PublicClient, processor: Address, records: Readonly<Record<string, RuleRecord>>, rules: readonly RuleCircuit[] = RULES): Promise<RuleCheck[]> {
  return Promise.all(
    rules.map(async (rule): Promise<RuleCheck> => {
      const rec = records[rule.name];
      const gates = ruleGates(rule);
      if (!rec) return { name: rule.name, id: null, status: "missing", gates };
      try {
        const stored = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [BigInt(rec.id)] })) as Hex;
        return { name: rule.name, id: rec.id, status: stored.toLowerCase() === ruleHex(rule).toLowerCase() ? "match" : "differs", gates };
      } catch {
        return { name: rule.name, id: rec.id, status: "unreachable", gates };
      }
    }),
  );
}

/** One word for the whole check: every rule matches, at least one does not, or the chain could not be read. */
export function rulesVerdict(checks: readonly RuleCheck[]): "verified" | "broken" | "unknown" {
  if (checks.some((c) => c.status === "differs" || c.status === "missing")) return "broken";
  if (checks.some((c) => c.status === "unreachable")) return "unknown";
  return "verified";
}
