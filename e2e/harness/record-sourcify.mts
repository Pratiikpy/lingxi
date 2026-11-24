/**
 * Records Sourcify's real answers for the mainnet deployment's addresses (A71), for the browser suite's stand-in:
 * `npx tsx e2e/harness/record-sourcify.mts` asks Sourcify about every address in deployments/xlayer.json and writes
 * the answers it gave (status and body) to sourcify-recorded.json. Run it again when a contract is added or verified.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const d = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<
  string,
  unknown
>;
const addresses = [
  ...new Set(
    Object.values(d)
      .filter((v): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v))
      .map((a) => a.toLowerCase()),
  ),
];
const out: Record<string, { status: number; body: unknown }> = {};
for (const a of addresses) {
  const r = await fetch(`https://sourcify.dev/server/v2/contract/196/${a}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  // the fields the game reads, as Sourcify gave them
  out[a] = {
    status: r.status,
    body:
      body && r.ok
        ? {
            match: body.match ?? null,
            creationMatch: body.creationMatch ?? null,
            runtimeMatch: body.runtimeMatch ?? null,
          }
        : body,
  };
}
writeFileSync(
  join(import.meta.dirname, "sourcify-recorded.json"),
  `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), answers: out }, null, 2)}\n`,
);
console.log(
  Object.entries(out)
    .map(([a, x]) => `${a.slice(0, 10)} ${x.status} ${(x.body as { match?: string } | null)?.match ?? ""}`)
    .join("\n"),
);
