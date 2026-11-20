/**
 * A daily budget of model tokens for teaching in words and the pets' voices. Every call through the wrapped client
 * is counted from the usage the API reports; once the day's tokens are spent, calls are refused until the next UTC
 * day, so a flood of requests cannot run up the bill. The day's spend is kept on disk and survives a restart.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PREFIX_SHARE, prefixOf } from "./limit";

export class BudgetSpent extends Error {
  constructor() {
    super("today's model budget is spent");
  }
}

/** One address has spent its share of the day (A53); others may still call. */
export class ShareSpent extends Error {
  constructor() {
    super("this address's share of today's model budget is spent");
  }
}

/**
 * The address a model call is made for (A53): a route runs its work inside `modelCaller.run(address, …)`, and every
 * model call that work makes, however deep, is charged to that address.
 */
export const modelCaller = new AsyncLocalStorage<string>();

/** Addresses whose spend the day keeps; past this the day's map is full and new addresses share one entry. */
const MAX_ADDRESSES = 20_000;
/**
 * The last part of the day kept for those who have spent little (A83): once the day is this far spent, an address that
 * has used more than LIGHT of its share waits for tomorrow, so twenty addresses at their full share cannot leave a
 * newcomer nothing. An IPv6 /48 has four addresses' worth (limit.ts), counted under its own key.
 */
const KEPT_FOR_LIGHT = 0.25;
const LIGHT = 0.25;

interface DayState {
  day: string;
  used: number;
  calls: number;
  by: Record<string, number>;
}

export function createTokenBudget(opts: { perDay: number; perAddress?: number; file?: string; now?: () => number }) {
  const now = opts.now ?? Date.now;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const fresh = (): DayState => ({ day: today(), used: 0, calls: 0, by: {} });
  let state = fresh();
  if (opts.file) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, "utf8")) as Partial<DayState>;
      if (saved.day === state.day && Number.isFinite(saved.used)) state = { ...fresh(), ...saved, by: saved.by ?? {}, calls: saved.calls ?? 0 } as DayState;
    } catch {
      // first run
    }
  }
  const roll = () => {
    if (state.day !== today()) state = fresh();
  };
  const keyOf = (address: string) => (address in state.by || Object.keys(state.by).length < MAX_ADDRESSES ? address : "(others)");
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
    /** whether `address` may still call today (its share), when a share is set */
    allowFor(address: string | undefined): boolean {
      roll();
      if (!opts.perAddress || address === undefined) return true;
      const mine = state.by[keyOf(address)] ?? 0;
      const prefix = prefixOf(address);
      if (mine >= opts.perAddress) return false;
      if (prefix !== null && (state.by[keyOf(prefix)] ?? 0) >= opts.perAddress * PREFIX_SHARE) return false;
      return state.used < opts.perDay * (1 - KEPT_FOR_LIGHT) || mine < opts.perAddress * LIGHT;
    },
    spend(tokens: number, address?: string): void {
      roll();
      state.used += tokens;
      state.calls += 1;
      if (address !== undefined) {
        const k = keyOf(address);
        state.by[k] = (state.by[k] ?? 0) + tokens;
        const prefix = prefixOf(address);
        if (prefix !== null) {
          const n = keyOf(prefix);
          state.by[n] = (state.by[n] ?? 0) + tokens;
        }
      }
      save();
    },
    used(): number {
      roll();
      return state.used;
    },
    /** the day's calls and the tokens each cost on average, measured from the usage the API reported (A53) */
    measured(): { calls: number; perCall: number } {
      roll();
      return { calls: state.calls, perCall: state.calls ? Math.round(state.used / state.calls) : 0 };
    },
    perDay: opts.perDay,
    perAddress: opts.perAddress ?? null,
  };
}
export type TokenBudget = ReturnType<typeof createTokenBudget>;

type Usage = { usage?: { input_tokens?: number; output_tokens?: number } };

/** The same client, with every `messages.create` (plain and beta) checked against and counted into `budget`. */
export function budgetedClient(client: Anthropic, budget: TokenBudget): Anthropic {
  const wrap = <F extends (...a: never[]) => Promise<unknown>>(create: F): F =>
    (async (...args: Parameters<F>) => {
      if (!budget.allow()) throw new BudgetSpent();
      const caller = modelCaller.getStore();
      if (!budget.allowFor(caller)) throw new ShareSpent();
      const res = (await create(...args)) as Usage;
      budget.spend((res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0), caller);
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
