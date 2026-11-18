import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRIENDS, renameLegacy, renameLegacyString, stepState, stepsTaken, trustOf, type WorldState } from "../src";
import { RESIDENT_FRIENDS } from "../src/friends/residents";
import { scanNames } from "../src/names";

/**
 * A world save written by the game's own code from the last commit before the residents were renamed: every resident
 * given gifts, every friendship step that was open taken, talks counted. Kept base64-encoded so the repo does not
 * carry the old names in plain text.
 */
const OLD = readFileSync(new URL("./fixtures/world-before-rename.b64", import.meta.url), "utf8").replace(/\s/g, "");
const old = JSON.parse(Buffer.from(OLD, "base64").toString("utf8")) as WorldState;
const now = renameLegacy(old);

const total = (r: Record<string, number> | undefined) => Object.values(r ?? {}).reduce((a, b) => a + b, 0);

describe("saves from before the residents were renamed", () => {
  it("carry no old name once loaded, but in the player's own words", () => {
    expect(scanNames(JSON.stringify(old)).length).toBeGreaterThan(0);
    expect(scanNames(JSON.stringify({ ...now, looks: [] }))).toEqual([]);
  });

  it("keep every resident's trust, steps, known tastes and talks under the new names", () => {
    for (const f of RESIDENT_FRIENDS) {
      expect(trustOf(now, f.id), f.id).toBe(40);
      expect(stepsTaken(now, f.id).length, f.id).toBeGreaterThanOrEqual(2);
      for (const id of stepsTaken(now, f.id)) {
        const step = f.steps.find((s) => s.id === id);
        expect(step, `${f.id} step ${id}`).toBeDefined();
        expect(stepState(now, f, step!), `${f.id} step ${id}`).toBe("taken");
      }
      expect(now.tally?.[`TALK:${f.id}`], f.id).toBe(4);
    }
    expect(Object.keys(now.trust ?? {})).toHaveLength(Object.keys(old.trust ?? {}).length);
    expect(total(now.tally)).toBe(total(old.tally));
    expect(Object.keys(now.tally ?? {})).toHaveLength(Object.keys(old.tally ?? {}).length);
    expect(Object.values(now.friends?.known ?? {}).flat()).toEqual(Object.values(old.friends?.known ?? {}).flat());
  });

  it("every id in the migrated save names a friend the game knows", () => {
    const ids = new Set(FRIENDS.map((f) => f.id));
    for (const who of [...Object.keys(now.trust ?? {}), ...Object.keys(now.friends?.steps ?? {}), ...(now.friends?.visits ?? [])]) expect(ids.has(who), who).toBe(true);
  });

  it("leave the player's own words alone", () => {
    expect(now.looks).toEqual(old.looks);
  });

  it("leave a save with nothing old in it untouched, down to the object", () => {
    expect(renameLegacy(now)).toBe(now);
    expect(renameLegacyString("praline:11130")).toBe("praline:11130");
    expect(renameLegacyString("TALK:13")).toBe("TALK:13");
  });
});
