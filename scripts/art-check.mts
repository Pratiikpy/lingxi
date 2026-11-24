/**
 * `npx tsx scripts/art-check.mts`: reads PetLook's six installed palettes from X Layer and says whether each draws as
 * meant (A17), and whether the art is frozen. Read-only: it sends no transaction. Run it before `freezeArt`, which
 * makes the installed art permanent and is Prateek's to send.
 *
 *   --deployment <file>   the deployment to read (default packages/chain/deployments/xlayer.json)
 */
import { readFileSync } from "node:fs";
import { type Address, createPublicClient, http } from "viem";
import { petLookAbi } from "../packages/chain/src/lookAbi.ts";
import { checkPalette } from "./lib/artCheck.mts";

const i = process.argv.indexOf("--deployment");
const deployment = JSON.parse(
  readFileSync(i < 0 ? "packages/chain/deployments/xlayer.json" : process.argv[i + 1]!, "utf8"),
) as { rpc: string; look?: Address };
if (!deployment.look) throw new Error("this deployment has no PetLook");
const look = deployment.look;
const pub = createPublicClient({ transport: http(deployment.rpc, { timeout: 20_000, retryCount: 3 }) });

/** PetLook's palettes: the three lines' pets, then their eggs. */
const PALETTES = 6;
const frozen = (await pub.readContract({ address: look, abi: petLookAbi, functionName: "artFrozen" })) as boolean;
const checks = [];
for (let id = 0; id < PALETTES; id++) {
  const bytes = (await pub.readContract({
    address: look,
    abi: petLookAbi,
    functionName: "palette",
    args: [BigInt(id)],
  })) as string;
  checks.push(checkPalette(id, bytes));
}
console.log(`PetLook ${look}: art ${frozen ? "frozen" : "open (freezeArt not sent)"}`);
for (const c of checks) {
  const see = c.seeThrough.length
    ? `; see-through: ${c.seeThrough.map((s) => `role ${s.role} alpha ${s.alpha}`).join(", ")}`
    : "";
  console.log(`  palette ${c.id}: ${c.ok ? "ok" : c.problems.join("; ")}${see}`);
}
const bad = checks.filter((c) => !c.ok).length;
console.log(
  bad ? `${bad} palette${bad === 1 ? "" : "s"} would draw wrongly: do not freeze` : "every palette draws as meant",
);
if (bad) process.exit(1);
