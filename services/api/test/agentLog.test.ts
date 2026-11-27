/**
 * P10: an agent's pet keeps no input log. A pet's log takes a word a minute it thinks (@lingxi/game sim.ts), and it
 * serves the pet's proofs on X Layer, its diary and Rewind; an agent's pet is never kept on chain, and no route serves
 * its log (the agent API shows its state, its season entry carries its card). Kept, it grew 14.3 KB a pet each day an
 * agent cared for it, without end: 70 MB a day at the cap of 5,000 pets, and the store's file with it. It is now started
 * afresh each time the pet is caught up, as a guest pet's is cut past its bound (A148), so the pet holds its state and
 * not its history.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentStore } from "../src/agents";

const DAY = 86_400_000;

describe("an agent's pet keeps no input log (P10)", () => {
  it("does not grow with the days it is cared for", () => {
    // the store's file is its pets as memory holds them: a pet's log, and its size a day, are read there
    vi.useFakeTimers();
    try {
      const file = join(mkdtempSync(join(tmpdir(), "agent-log-")), "agents.json");
      let now = Date.UTC(2026, 10, 1, 8);
      const store = createAgentStore(file, () => now);
      const tokens: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = store.adopt(`agent ${i}`, `Pet${i}`, "gentle", 0, `10.2.0.${i}`);
        if (r.ok) tokens.push(r.token);
      }
      /** each pet as the store keeps it, after `days` more days of an agent feeding it once a day */
      const keptAfter = (days: number) => {
        for (let d = 0; d < days; d++) {
          now += DAY;
          for (const t of tokens) expect(store.act(t, "feed").ok).toBe(true);
        }
        // the store writes what changed every 15 seconds
        vi.advanceTimersByTime(15_000);
        return Object.values(
          JSON.parse(readFileSync(file, "utf8")) as Record<string, { pet: { pendingLog: unknown[] } }>,
        );
      };
      // the first days fill a newborn's state once (its care counts, its log's start): not counted
      const before = keptAfter(2);
      const after = keptAfter(2);
      expect(after).toHaveLength(3);
      // a day it thinks is a word a minute: 1,440 words a day, 14.3 KB, when its log was kept
      for (const k of after) expect(k.pet.pendingLog).toHaveLength(0);
      const grew = (JSON.stringify(after).length - JSON.stringify(before).length) / 3 / 2;
      expect(grew, "characters a pet grew a day").toBeLessThan(500);
      expect(store.view(tokens[0] ?? "")?.day).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still lives as before: it ages, eats, learns and enters the season", () => {
    let now = Date.UTC(2026, 10, 1, 8);
    const store = createAgentStore(undefined, () => now);
    const r = store.adopt("agent one", "Mochi", "gentle", 0, "10.2.1.1");
    if (!r.ok) throw new Error("adopt");
    const day1 = store.view(r.token);
    now += 3 * DAY;
    expect(store.act(r.token, "feed").ok).toBe(true);
    const later = store.view(r.token);
    expect(later?.day).toBe((day1?.day ?? 0) + 3);
    const taught = store.teach(r.token, { when: { hunger: [3] }, then: { want: 1, mood: 2 } });
    expect(taught.ok).toBe(true);
    expect(store.view(r.token)?.lessons).toHaveLength(1);
    expect(store.seasonPet(r.token)?.pet.name).toBe("Mochi");
  });
});
