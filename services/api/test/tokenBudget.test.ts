import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { budgetedClient, createTokenBudget, modelCaller } from "../src/tokenBudget";
import { teachInWords } from "../src/teach";
import { createApp } from "../src/server";

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
    const r = await teachInWords(c as never, {
      words: "when hungry ask for food",
      name: "Mochi",
      stage: "child",
      mind: { line: "gentle", lessons: [] },
    });
    expect(r).toMatchObject({ ok: false, reason: "resting" });
  });
});

describe("each address has its share of the day, and the cost per call is measured (A53)", () => {
  it("an address past its share is refused before the model is called, another is not, and a new day resets it", async () => {
    let now = Date.UTC(2026, 10, 20, 9);
    const budget = createTokenBudget({ perDay: 100_000, perAddress: 3_400, now: () => now });
    const f = fakeClient();
    const c = budgetedClient(f.client as never, budget);
    const as = (ip: string) => modelCaller.run(ip, () => c.messages.create({} as never));
    await as("203.0.113.1");
    await as("203.0.113.1");
    await expect(as("203.0.113.1")).rejects.toThrow(/share/);
    expect(f.calls(), "refused before the model was called").toBe(2);
    await expect(as("198.51.100.1"), "another address teaches on").resolves.toBeTruthy();
    now += 86_400_000;
    await expect(as("203.0.113.1"), "a new day").resolves.toBeTruthy();
  });

  it("the shares survive a restart", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "lx-")), "budget.json");
    const a = createTokenBudget({ perDay: 100_000, perAddress: 3_400, file });
    const ca = budgetedClient(fakeClient().client as never, a);
    await modelCaller.run("203.0.113.1", () => ca.messages.create({} as never));
    await modelCaller.run("203.0.113.1", () => ca.messages.create({} as never));
    const b = createTokenBudget({ perDay: 100_000, perAddress: 3_400, file });
    const cb = budgetedClient(fakeClient().client as never, b);
    await expect(modelCaller.run("203.0.113.1", () => cb.messages.create({} as never))).rejects.toThrow(/share/);
  });

  it("counts the day's calls and reports the average tokens per call", async () => {
    const budget = createTokenBudget({ perDay: 100_000 });
    const c = budgetedClient(fakeClient({ input_tokens: 1000, output_tokens: 300 }).client as never, budget);
    await c.messages.create({} as never);
    await budgetedClient(
      fakeClient({ input_tokens: 2000, output_tokens: 100 }).client as never,
      budget,
    ).messages.create({} as never);
    expect(budget.measured()).toEqual({ calls: 2, perCall: 1_700 });
  });

  it("tells a player past their share that it is theirs, not everyone's", async () => {
    const budget = createTokenBudget({ perDay: 100_000, perAddress: 1 });
    const c = budgetedClient(fakeClient().client as never, budget);
    await modelCaller.run("203.0.113.1", () => c.messages.create({} as never));
    const r = await modelCaller.run("203.0.113.1", () =>
      teachInWords(c as never, {
        words: "when hungry ask for food",
        name: "Mochi",
        stage: "child",
        mind: { line: "gentle", lessons: [] },
      }),
    );
    expect(r).toMatchObject({ ok: false, reason: "yourShare" });
  });
});

describe("the teach route charges each lesson to the address that asked (A53)", () => {
  it("one address past its share is told yourShare while another address teaches on", async () => {
    const budget = createTokenBudget({ perDay: 100_000, perAddress: 1_700 });
    const app = createApp(budgetedClient(fakeClient().client as never, budget));
    const teach = async (ip: string) =>
      (await (
        await app.request("/api/teach", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": ip },
          body: JSON.stringify({
            words: "when hungry ask for food",
            name: "Mochi",
            line: "gentle",
            stage: "child",
            lessons: [],
          }),
        })
      ).json()) as { ok: boolean; reason?: string };
    // the stand-in model answers nothing a lesson can be made of, but each call is charged
    expect((await teach("203.0.113.1")).reason).not.toBe("yourShare");
    expect(await teach("203.0.113.1")).toMatchObject({ ok: false, reason: "yourShare" });
    expect((await teach("198.51.100.1")).reason).not.toBe("yourShare");
  });
});

describe("the model day keeps room for those who have spent little (A83)", () => {
  it("heavy addresses cannot spend the last quarter of the day; a newcomer still can", () => {
    const budget = createTokenBudget({ perDay: 100_000, perAddress: 10_000 });
    // seven heavy addresses spend their whole shares: 70% of the day
    for (let i = 0; i < 7; i++) budget.spend(10_000, `198.51.100.${i}`);
    // an eighth starts and spends past a quarter of its share, into the last quarter of the day
    budget.spend(5_000, "198.51.100.50");
    expect(budget.used()).toBe(75_000);
    expect(budget.allowFor("198.51.100.50"), "past a quarter of its share, it waits for tomorrow").toBe(false);
    expect(budget.allowFor("198.51.100.200"), "a newcomer is served from the quarter kept").toBe(true);
    budget.spend(2_000, "198.51.100.200");
    expect(budget.allowFor("198.51.100.200"), "and keeps being served while it has spent little").toBe(true);
  });

  it("calls in flight hold their tokens before they run, so a burst cannot overrun a share or the day (A121)", async () => {
    const budget = createTokenBudget({ perDay: 1_000_000, perAddress: 100_000 });
    const usage = { input_tokens: 2_500, output_tokens: 1_200 };
    // each call takes a while, as the model does, and asks for up to 1,200 tokens over about 2,500 of input
    const create = async () => (
      await new Promise((r) => setTimeout(r, 30)),
      { usage, content: [], stop_reason: "end_turn" }
    );
    const c = budgetedClient({ messages: { create }, beta: { messages: { create } } } as never, budget);
    const ask = { max_tokens: 1_200, messages: [{ role: "user", content: "x".repeat(7_500) }] };
    const burst = await Promise.allSettled(
      Array.from({ length: 46 }, () => modelCaller.run("203.0.113.21", () => c.messages.create(ask as never))),
    );
    const served = burst.filter((r) => r.status === "fulfilled").length;
    expect(served).toBeLessThan(46);
    expect(budget.used(), `${served} calls charged ${budget.used()}`).toBeLessThanOrEqual(100_000 + 3_700);
    // the day's ceiling holds the same way
    const day = createTokenBudget({ perDay: 20_000 });
    const d = budgetedClient({ messages: { create }, beta: { messages: { create } } } as never, day);
    await Promise.allSettled(Array.from({ length: 30 }, () => d.messages.create(ask as never)));
    expect(day.used()).toBeLessThanOrEqual(20_000 + 3_700);
    // a call that fails gives its hold back
    const failing = createTokenBudget({ perDay: 10_000 });
    const f = budgetedClient(
      { messages: { create: async () => Promise.reject(new Error("down")) }, beta: { messages: { create } } } as never,
      failing,
    );
    await expect(f.messages.create(ask as never)).rejects.toThrow("down");
    expect(failing.allow(), "nothing is held for a call that failed").toBe(true);
    expect(failing.used()).toBe(0);
  });

  it("an IPv6 /48 has four addresses' worth of the day, across its /64s", () => {
    const budget = createTokenBudget({ perDay: 1_000_000, perAddress: 10_000 });
    for (let i = 0; i < 4; i++) budget.spend(10_000, `2001:db8:7:${i}::/64`);
    expect(budget.allowFor("2001:db8:7:99::/64"), "the network's share is spent").toBe(false);
    expect(budget.allowFor("2001:db8:8:1::/64"), "another network is not affected").toBe(true);
  });
});
