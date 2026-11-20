/**
 * A daily budget of model tokens for teaching in words and the pets' voices. Every call through the wrapped client
 * is counted from the usage the API reports; once the day's tokens are spent, calls are refused until the next UTC
 * day, so a flood of requests cannot run up the bill. The day's spend is kept on disk and survives a restart. A call
 * holds what it may cost before it runs (A121), so calls in flight together count against the share, the quarter kept
 * and the day as though spent, and settle to what the API reports.
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
  /** tokens held by calls in flight: the day's, and each address's and /48's (A121) */
  const held = { used: 0, by: new Map<string, number>() };
  const hold = (key: string, tokens: number) => {
    const n = (held.by.get(key) ?? 0) + tokens;
    if (n > 0) held.by.set(key, n);
    else held.by.delete(key);
  };
  /** what an address (or /48) has spent today and holds in flight */
  const spentBy = (key: string) => (state.by[keyOf(key)] ?? 0) + (held.by.get(key) ?? 0);
  const keysFor = (address: string | undefined) => (address === undefined ? [] : [address, ...(prefixOf(address) !== null ? [prefixOf(address)!] : [])]);
  const save = () => {
    if (!opts.file) return;
    mkdirSync(dirname(opts.file), { recursive: true });
    writeFileSync(`${opts.file}.tmp`, JSON.stringify(state));
    renameSync(`${opts.file}.tmp`, opts.file);
  };
  return {
    allow(): boolean {
      roll();
      return state.used + held.used < opts.perDay;
    },
    /** whether `address` may still call today (its share), when a share is set */
    allowFor(address: string | undefined): boolean {
      roll();
      if (!opts.perAddress || address === undefined) return true;
      const mine = spentBy(address);
      const prefix = prefixOf(address);
      if (mine >= opts.perAddress) return false;
      if (prefix !== null && spentBy(prefix) >= opts.perAddress * PREFIX_SHARE) return false;
      return state.used + held.used < opts.perDay * (1 - KEPT_FOR_LIGHT) || mine < opts.perAddress * LIGHT;
    },
    /**
     * Holds `tokens` for a call `address` is about to make, when the day and its share allow (A121): "day" or "share"
     * when they do not. The hold counts as spent until `settle` replaces it with what the call actually cost.
     */
    reserve(tokens: number, address: string | undefined): { settle(actual: number): void } | "day" | "share" {
      if (!this.allow()) return "day";
      if (!this.allowFor(address)) return "share";
      held.used += tokens;
      for (const k of keysFor(address)) hold(k, tokens);
      let settled = false;
      return {
        settle: (actual: number) => {
          if (settled) return;
          settled = true;
          held.used -= tokens;
          for (const k of keysFor(address)) hold(k, -tokens);
          if (actual > 0) this.spend(actual, address);
        },
      };
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

/**
 * What a call may cost, held before it runs (A121): the output it may write (`max_tokens`) and its input, counted at a
 * token for every three characters of what it sends, which is above what the model counts for English or Chinese.
 */
export function holdFor(args: unknown): number {
  const a = (args ?? {}) as { max_tokens?: unknown; messages?: unknown; system?: unknown; tools?: unknown };
  const out = typeof a.max_tokens === "number" && Number.isFinite(a.max_tokens) ? a.max_tokens : 0;
  const sent = JSON.stringify([a.system ?? "", a.messages ?? [], a.tools ?? []]).length;
  return out + Math.ceil(sent / 3);
}

/** The same client, with every `messages.create` (plain and beta) checked against and counted into `budget`. */
export function budgetedClient(client: Anthropic, budget: TokenBudget): Anthropic {
  const wrap = <F extends (...a: never[]) => Promise<unknown>>(create: F): F =>
    (async (...args: Parameters<F>) => {
      const caller = modelCaller.getStore();
      // the call holds what it may cost before it runs, so calls in flight together cannot overrun (A121)
      const held = budget.reserve(holdFor(args[0]), caller);
      if (held === "day") throw new BudgetSpent();
      if (held === "share") throw new ShareSpent();
      let res: Usage;
      try {
        res = (await create(...args)) as Usage;
      } catch (e) {
        // a call that failed costs nothing here: its hold is given back
        held.settle(0);
        throw e;
      }
      held.settle((res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0));
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
