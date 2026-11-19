import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetedClient, createTokenBudget } from "../src/tokenBudget";
import { teachInWords } from "../src/teach";

/** A stand-in client whose every call reports the usage it is given. */
const fakeClient = (usage = { input_tokens: 1500, output_tokens: 200 }) => {
  let calls = 0;
  const create = async () => (calls++, { usage, content: [], stop_reason: "end_turn" });
  return { client: { messages: { create }, beta: { messages: { create } } }, calls: () => calls };
};

describe("the daily token budget for teaching and voices", () => {
  it("counts every call's tokens and refuses once the day's budget is spent", async () => {
    const budget = createTokenBudget({ perDay: 5_000 });
    const f = fakeClient();
    const c = budgetedClient(f.client as never, budget);
    await c.messages.create({} as never);
    await c.beta.messages.create({} as never);
    await c.messages.create({} as never);
    expect(budget.used()).toBe(5_100);
    await expect(c.messages.create({} as never)).rejects.toThrow(/budget/);
    expect(f.calls()).toBe(3);
  });

  it("starts each day afresh", async () => {
    let now = Date.UTC(2026, 10, 18, 12);
    // the budget refuses once spent, so it overshoots by at most one call
    const budget = createTokenBudget({ perDay: 1_500, now: () => now });
    const c = budgetedClient(fakeClient().client as never, budget);
    await c.messages.create({} as never);
    await expect(c.messages.create({} as never)).rejects.toThrow(/budget/);
    now += 86_400_000;
    await expect(c.messages.create({} as never)).resolves.toBeTruthy();
  });

  it("survives a restart: the day's spend is kept on disk", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "lx-")), "budget.json");
    const a = createTokenBudget({ perDay: 10_000, file });
    await budgetedClient(fakeClient().client as never, a).messages.create({} as never);
    const b = createTokenBudget({ perDay: 10_000, file });
    expect(b.used()).toBe(1_700);
    expect(JSON.parse(readFileSync(file, "utf8")).used).toBe(1_700);
  });

  it("tells a player teaching in words that today's share is used, not to try again in a minute", async () => {
    const budget = createTokenBudget({ perDay: 1 });
    const f = fakeClient();
    const c = budgetedClient(f.client as never, budget);
    await c.messages.create({} as never);
    const r = await teachInWords(c as never, { words: "when hungry ask for food", name: "Mochi", stage: "child", mind: { line: "gentle", lessons: [] } });
    expect(r).toMatchObject({ ok: false, reason: "resting" });
  });
});
