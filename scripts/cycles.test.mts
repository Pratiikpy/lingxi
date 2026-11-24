/**
 * P7: no module imports another that, at run time, imports it back. A cycle makes a module's exports undefined while
 * the other half is still loading, and it ties code together that should change apart. Type-only imports are left out:
 * they are erased before anything runs. Five such cycles in the web app and one in the game package were broken on
 * 2026-11-25; this keeps a new one from coming in.
 */
import { join } from "node:path";
import madge from "madge";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const SOURCES = [
  "apps/web/src",
  "services/api/src",
  "packages/game/src",
  "packages/world/src",
  "packages/brain/src",
  "packages/chain/src",
  "packages/art/src",
  "packages/handheld/src",
  "packages/send/src",
  "packages/api/src",
];

describe("no import cycles at run time (P7)", () => {
  for (const dir of SOURCES) {
    it(dir, async () => {
      const graph = await madge(join(root, dir), {
        fileExtensions: ["ts", "tsx"],
        tsConfig: dir === "apps/web/src" ? join(root, "apps/web/tsconfig.json") : undefined,
        detectiveOptions: { ts: { skipTypeImports: true }, tsx: { skipTypeImports: true } },
      });
      expect(graph.circular().map((c: string[]) => c.join(" > "))).toEqual([]);
    }, 120_000);
  }
});
