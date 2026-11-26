/**
 * R12 (P8): a dead RPC shows on the health report within a minute, on a real node. healthChain.test.ts shows the
 * report's words by handing it a head that fails under a stopped clock; here a real anvil fork is started, read
 * through the same reader the server uses (chainHead), and killed. The report must then say "unreachable", with the
 * reason, inside a minute of real time, the 30 s for which a report is cached included. Skipped unless FORK_RPC is set
 * (`pnpm test:fork`): the node here is a fork of that fork, so killing it leaves the other tests' chain alone.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healthDetail } from "../src/boot/health";
import { chainHead } from "../src/boot/registryJobs";
import { createJobs } from "../src/jobs";
import { createTokenBudget } from "../src/tokenBudget";

const FORK = process.env.FORK_RPC;
const MINUTE = 60_000;

const freePort = () =>
  new Promise<number>((yes, no) => {
    const s = createServer();
    s.once("error", no);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => yes(port));
    });
  });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!FORK)("a killed node, on the health report (R12)", () => {
  it(
    "the report says the chain is ok, the node is killed, and within a minute it says unreachable and why",
    async () => {
      const port = await freePort();
      const node = spawn("anvil", ["--fork-url", FORK!, "--port", String(port), "--silent"], { stdio: "ignore" });
      const gone = new Promise<void>((yes) => node.once("exit", () => yes()));
      try {
        const head = chainHead(`http://127.0.0.1:${port}`);
        // the node is up when it answers
        for (let i = 0; i < 120; i++) {
          if (
            await head().then(
              () => true,
              () => false,
            )
          )
            break;
          await pause(500);
        }
        const report = healthDetail({
          jobs: createJobs(() => {}),
          client: null,
          modelBudget: createTokenBudget({ perDay: 1_000 }),
          relayer: null,
          watch: { head, indexed: () => 0 },
          dataDir: mkdtempSync(join(tmpdir(), "lingxi-health-fork-")),
        });
        expect((await report.detail()).chain, "the node answers").toBe("ok");

        const killedAt = Date.now();
        node.kill();
        await gone;
        let chain = "";
        while (Date.now() - killedAt < MINUTE) {
          chain = String((await report.detail()).chain);
          if (chain.startsWith("unreachable")) break;
          await pause(2_000);
        }
        const took = Date.now() - killedAt;
        expect(chain, `after ${Math.round(took / 1000)} s`).toMatch(/^unreachable: \S/);
        expect(took, "named within a minute of the node dying").toBeLessThan(MINUTE);
      } finally {
        node.kill();
      }
    },
    4 * MINUTE,
  );
});
