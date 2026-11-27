/**
 * P10: an agent's pet keeps no input log. A pet's log takes a word a minute it thinks (@lingxi/game sim.ts), and it
 * serves the pet's proofs on X Layer, its diary and Rewind; an agent's pet is never kept on chain, and no route serves
 * its log (the agent API shows its state, its season entry carries its card). Kept, it grew 14.3 KB a pet each day an
 * agent cared for it, without end: 70 MB a day at the cap of 5,000 pets, and the store's file with it. It is now started
 * afresh each time the pet is caught up, as a guest pet's is cut past its bound (A148), so the pet holds its state and
 * not its history.
 */
import { describe, expect, it } from "vitest";
import { createAgentStore } from "../src/agents";
import { bytesEach } from "./heap";

const DAY = 86_400_000;

describe("an agent's pet keeps no input log (P10)", () => {
  it("does not grow with the days it is cared for", async () => {
    let now = Date.UTC(2026, 10, 1, 8);
    const n = 100;
    const tokens: string[] = [];
    const feedAll = (s: ReturnType<typeof createAgentStore>) => {
      now += DAY;
      for (const t of tokens) expect(s.act(t, "feed").ok).toBe(true);
    };
    const [each, store] = await bytesEach(
      n,
      () => {
        const s = createAgentStore(undefined, () => now);
        for (let i = 0; i < n; i++) {
          const r = s.adopt(`agent ${Math.floor(i / 5)}`, `Pet${i}`, "gentle", 0, `10.2.0.${Math.floor(i / 5)}`);
          if (r.ok) tokens.push(r.token);
        }
        // the first day fills a newborn's state once (its log's start, its care counts): not counted
        feedAll(s);
        return s;
      },
      async (s) => {
        // four more days of an agent feeding each pet once a day
        for (let d = 0; d < 4; d++) feedAll(s);
      },
    );
    // with its log, a pet grew 14.3 KB a day: 57 KB over these four; now the days add nothing but noise
    expect(each).toBeLessThan(3_000);
    expect(store.view(tokens[0] ?? "")?.day).toBe(6);
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
