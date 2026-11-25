/**
 * P7c: every fork test talks to its fork through forkHttp (packages/chain/test/forkRpc.ts), which waits long enough for
 * a cold read from X Layer and sends each request once. A fork test calling viem's http() on the fork itself would wait
 * the default 10 s, and fail on the first slow read, as fork.test.ts once did.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const DIRS = ["packages/chain/test", "services/api/test"];

const forkTests = DIRS.flatMap((d) =>
  readdirSync(join(root, d))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(d, f))
    .filter((f) => readFileSync(join(root, f), "utf8").includes("FORK_RPC")),
);

describe("fork tests use the fork transport (P7c)", () => {
  it("finds the fork tests", () => {
    expect(forkTests.length).toBeGreaterThan(15);
  });

  it("none reaches its fork through viem's http() with its defaults", () => {
    const direct = forkTests.filter((f) => /\bhttp\(\s*RPC\b/.test(readFileSync(join(root, f), "utf8")));
    expect(direct.map((f) => f.split("\\").join("/"))).toEqual([]);
  });
});
