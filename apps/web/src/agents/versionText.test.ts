/**
 * D17: what agents read about fights never names a version the game no longer fights in. The manifest (served at
 * /api/v1/profiles) and the agents page say every result carries its version; any version they do name is the current one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as manifests from "@lingxi/brain";
import { CURRENT_SPAR } from "@lingxi/game";

describe("fight versions in agent-facing text (D17)", () => {
  it("names no fight version but the current one, and says each result carries its own", () => {
    const page = readFileSync(resolve(__dirname, "AgentsApp.tsx"), "utf8");
    const served = JSON.stringify(manifests);
    for (const text of [page, served]) for (const v of text.match(/LX-SPAR\/\d+/g) ?? []) expect(v).toBe(CURRENT_SPAR);
    expect(served).toContain("names the fight version it was fought in");
    expect(page).toContain("每个结果都写明它所用的切磋版本");
  });
});
