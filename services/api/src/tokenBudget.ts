/**
 * A daily budget of model tokens for teaching in words and the pets' voices. Every call through the wrapped client
 * is counted from the usage the API reports; once the day's tokens are spent, calls are refused until the next UTC
 * day, so a flood of requests cannot run up the bill. The day's spend is kept on disk and survives a restart.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class BudgetSpent extends Error {
  constructor() {
    super("today's model budget is spent");
  }
}

export function createTokenBudget(opts: { perDay: number; file?: string; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  let state = { day: today(), used: 0 };
  if (opts.file) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, "utf8")) as { day: string; used: number };
      if (saved.day === state.day && Number.isFinite(saved.used)) state = saved;
    } catch {
      // first run
    }
  }
  const roll = () => {
    if (state.day !== today()) state = { day: today(), used: 0 };
  };
  const save = () => {
    if (!opts.file) return;
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(`${opts.file}.tmp`, JSON.stringify(state));
    renameSync(`${opts.file}.tmp`, opts.file);
  };
  return {
    allow(): boolean {
      roll();
      return state.used < opts.perDay;
    },
    spend(tokens: number): void {
      roll();
      state.used += tokens;
      save();
    },
    used(): number {
      roll();
      return state.used;
    },
    perDay: opts.perDay,
  };
}
export type TokenBudget = ReturnType<typeof createTokenBudget>;

type Usage = { usage?: { input_tokens?: number; output_tokens?: number } };

/** The same client, with every `messages.create` (plain and beta) checked against and counted into `budget`. */
export function budgetedClient(client: Anthropic, budget: TokenBudget): Anthropic {
  const wrap = <F extends (...a: never[]) => Promise<unknown>>(create: F): F =>
    (async (...args: Parameters<F>) => {
      if (!budget.allow()) throw new BudgetSpent();
      const res = (await create(...args)) as Usage;
      budget.spend((res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0));
      return res;
    }) as F;
  const messages = { ...client.messages, create: wrap(client.messages.create.bind(client.messages)) };
  const beta = { ...client.beta, messages: { ...client.beta.messages, create: wrap(client.beta.messages.create.bind(client.beta.messages)) } };
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "messages") return messages;
      if (prop === "beta") return beta;
      return Reflect.get(target, prop, receiver);
    },
  });
}
