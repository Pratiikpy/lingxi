/**
 * `pnpm dev`: the game and its server together, as a fresh clone needs them.
 *   the game  http://localhost:5199  (against X Layer mainnet)
 *   the API   http://localhost:8787  (live rooms, mail, the X Layer door; teaching needs ANTHROPIC_API_KEY)
 * Ctrl+C stops both; if either stops, so does the other.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "services", "api");
const web = join(root, "apps", "web");
// each tool from its own package, run by this same Node: no nested pnpm (two at once race on its state file), no shell
const tsx = createRequire(join(api, "package.json")).resolve("tsx/cli");
const vite = join(dirname(createRequire(join(web, "package.json")).resolve("vite/package.json")), "bin", "vite.js");
const parts = [
  ["api", [tsx, "src/server.ts"], api],
  ["web", [vite], web],
];
const children = parts.map(([name, args, cwd]) => {
  const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (b) => process.stdout.write(String(b).replace(/^(?=.)/gm, `[${name}] `)));
  child.on("exit", (code) => {
    process.stdout.write(`[${name}] stopped (${code ?? "signal"})\n`);
    stopAll(code ?? 1);
  });
  return child;
});

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
