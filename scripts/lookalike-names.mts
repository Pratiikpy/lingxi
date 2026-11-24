/**
 * `npx tsx scripts/lookalike-names.mts`: every pet's current name on X Layer, read from PetLook, and each one that
 * carries a character that draws as nothing (A16), with the pets it passes for. Read-only: it sends no transaction.
 * Freeing such a name is the owner's `releaseName(petId)`, a mainnet transaction that is Prateek's to send.
 *
 *   --deployment <file>   the deployment to read (default packages/chain/deployments/xlayer.json)
 *   --check               exit 1 when any look-alike is found
 */
import { readFileSync } from "node:fs";
import { type Address, createPublicClient, http } from "viem";
import { petLookAbi } from "../packages/chain/src/lookAbi.ts";
import { petRegistryAbi } from "../packages/chain/src/registryAbi.ts";
import { escaped, findLookalikes, type NamedPet } from "./lib/lookalikes.mts";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
};
const deployment = JSON.parse(
  readFileSync(arg("--deployment") ?? "packages/chain/deployments/xlayer.json", "utf8"),
) as { rpc: string; registry: Address; look?: Address };
if (!deployment.look) throw new Error("this deployment has no PetLook");
const look = deployment.look;
const pub = createPublicClient({ transport: http(deployment.rpc, { timeout: 20_000, retryCount: 3 }) });

/** Names are read a few at a time, so a public node's rate limit is never met. */
const BATCH = 8;
const next = (await pub.readContract({
  address: deployment.registry,
  abi: petRegistryAbi,
  functionName: "nextPetId",
})) as bigint;
const pets: NamedPet[] = [];
for (let id = 1n; id < next; id += BigInt(BATCH)) {
  const ids = Array.from(
    { length: Number(next - id < BigInt(BATCH) ? next - id : BigInt(BATCH)) },
    (_, k) => id + BigInt(k),
  );
  const names = await Promise.all(
    ids.map(
      (petId) =>
        pub.readContract({ address: look, abi: petLookAbi, functionName: "nameOf", args: [petId] }) as Promise<string>,
    ),
  );
  ids.forEach((petId, k) => pets.push({ petId, name: names[k]! }));
}

const named = pets.filter((p) => p.name);
const found = findLookalikes(pets);
console.log(
  `PetLook ${look}: ${pets.length} pets, ${named.length} named, ${found.length} look-alike${found.length === 1 ? "" : "s"}`,
);
for (const l of found) {
  const of = l.imitates.length ? `passes for pet ${l.imitates.map(String).join(", ")}` : "passes for no pet yet";
  console.log(`  pet ${l.petId}: "${escaped(l.name)}" (${l.hidden} hidden), ${of}; freed by releaseName(${l.petId})`);
}
if (process.argv.includes("--check") && found.length) process.exit(1);
