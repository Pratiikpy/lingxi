/**
 * R4: fetches the contracts' two libraries, pinned as git submodules (OpenZeppelin Contracts v5.4.0 at c64a1ed and
 * forge-std at 15b2df9), and checks their files out with LF line endings on every system. The compiler records a hash
 * of each source file in a contract's metadata, so a Windows checkout with CRLF endings would build different bytes
 * from the contracts deployed on X Layer; with LF it builds the same, metadata included.
 *
 *   pnpm contracts:libs      then      cd contracts && forge build
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const LIBS = ["contracts/lib/forge-std", "contracts/lib/openzeppelin-contracts"];
const git = (args: string[], cwd = root) => execFileSync("git", args, { cwd, stdio: "inherit" });

git(["submodule", "update", "--init", ...LIBS]);
for (const lib of LIBS) {
  const at = join(root, lib);
  git(["config", "core.autocrlf", "false"], at);
  git(["config", "core.eol", "lf"], at);
  // the files written again under the new setting
  git(["rm", "--cached", "-r", "-q", "."], at);
  git(["reset", "--hard", "-q"], at);
}
process.stdout.write(`contract libraries ready: ${LIBS.join(", ")}\n`);
