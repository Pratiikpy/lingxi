/**
 * What the shop, red packet, relay and season specs share: reads of the fork with viem (BEM balances, pieces held,
 * the extras a wallet bought, a pet on chain), the fork's own controls (mining a block, funding a throwaway sender),
 * and the few moves a player makes on the way to those flows (reaching a panel low in a sheet, keeping the pet on
 * X Layer, waiting for a panel's message).
 *
 * Every write here goes to the local fork the harness started: the RPC is checked to be on this machine first.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Address,
  type PublicClient,
  type WalletClient,
  createPublicClient,
  createWalletClient,
  http,
  numberToHex,
  parseAbi,
} from "viem";
import { xLayer } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Locator, Page } from "@playwright/test";
import { assertLocal, giveToken } from "../../packages/chain/scripts/lib/forkFund";
import { XLAYER_USDT, claimPacket, createPacket, revealPacket, signClaim } from "../../packages/chain/src/redpacket";
import type { Deployment } from "../../packages/chain/src/registry";
import { type Run, testAccount } from "../harness/run";

export const DEAD: Address = "0x000000000000000000000000000000000000dEaD";

/** The deployment record the server and the game run on, pointed at the fork. */
export interface ForkDeployment {
  registry: Address;
  itemShop: Address;
  outfitMarketV2: Address;
  extras: Address;
  redPacket: Address;
  items: Record<string, string>;
  rpc: string;
  [k: string]: unknown;
}

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const erc1155 = parseAbi(["function balanceOf(address, uint256) view returns (uint256)"]);
const shopAbi = parseAbi(["function bem() view returns (address)"]);
const extrasAbi = parseAbi([
  "function extrasOf(address) view returns (uint8, uint8, uint96, uint96, uint96, uint8)",
  "function nameColour(uint256) view returns (uint8)",
  "function totalBurned() view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function isKeeper(uint256, address) view returns (bool)",
  "function pet(uint256) view returns ((address processor, uint64 brainId, uint8 line, uint8 brainBits, uint32 day, uint40 born, uint40 checkedAt, bytes32 logHash, uint256 state, uint128 parentA, uint128 parentB))",
]);

export interface Fork {
  pub: PublicClient;
  d: ForkDeployment;
  bem: Address;
  /** a wallet on the fork for test account `index` (any index of the public test mnemonic) */
  wallet: (index: number) => WalletClient;
  bemOf: (who: Address) => Promise<bigint>;
  /** copies of an item-shop piece (by its id in the deployment's `items`) that `who` holds */
  heldOf: (who: Address, item: string) => Promise<bigint>;
  /** room packs and looks packs bought by `who` */
  packsOf: (who: Address) => Promise<{ room: number; looks: number }>;
  colourOf: (petId: string) => Promise<number>;
  extrasBurned: () => Promise<bigint>;
  ownerOf: (petId: string) => Promise<Address>;
  brainOf: (petId: string) => Promise<bigint>;
  /** whether `who` may keep the pet on chain now (its owner, or its sitter) */
  isKeeper: (petId: string, who: Address) => Promise<boolean>;
  /** mines `n` empty blocks: the fork only makes a block for a transaction or when asked */
  mine: (n?: number) => Promise<void>;
  /** sets a native balance (OKB, in wei) */
  setOkb: (who: Address, wei: bigint) => Promise<void>;
  /** makes `who` a plain wallet on the fork again, with no code (see forkOf) */
  plain: (who: Address) => Promise<void>;
}

/**
 * Waits until the server's first reading of Builders' Lane is done. That reading asks every processor in TapeOut's
 * factory at once, hundreds of contracts the fork has never touched, and the fork fetches each from X Layer before it
 * answers anything else: until it is done, a transaction from a spec or the game can wait a minute or more.
 */
async function settled(run: Run): Promise<void> {
  const until = Date.now() + 300_000;
  while (Date.now() < until) {
    const lane = (await (await fetch(`${run.api}/api/lane/tapeouts`)).json()) as { ok: boolean };
    if (lane.ok) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("the server's first reading of the chain did not finish in 5 minutes");
}

/** The fork of this run, read and driven with viem, once the server's start-up reads of it are done. */
export async function forkOf(run: Run): Promise<Fork> {
  assertLocal(run.fork.rpc);
  await settled(run);
  const d = JSON.parse(readFileSync(join(run.dir, "deployment.json"), "utf8")) as ForkDeployment;
  const chain = { ...xLayer, rpcUrls: { default: { http: [run.fork.rpc] } } };
  // a call the fork answers from X Layer can take a while; it is waited for, never sent twice
  const pub = createPublicClient({
    chain,
    transport: http(run.fork.rpc, { timeout: 60_000, retryCount: 0 }),
  }) as PublicClient;
  const bem = await pub.readContract({ address: d.itemShop, abi: shopAbi, functionName: "bem" });
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
  const plain = async (who: Address) => {
    if (((await pub.getCode({ address: who })) ?? "0x") !== "0x") await rpc("anvil_setCode", [who, "0x"]);
  };
  // The public test keys are public on X Layer mainnet too, and strangers have delegated some of them (EIP-7702): at
  // the pinned block wallets 0 and 1 carry a delegation to someone's contract, which refuses the pet a registry mints
  // to it (ERC721InvalidReceiver). The players' wallets are meant to be plain wallets, so on the fork they are made
  // plain again before a spec plays. This belongs in the harness's funding step; it is here until it is.
  for (const pl of run.players) await plain(pl.address);
  return {
    pub,
    d,
    bem,
    wallet: (index) =>
      createWalletClient({
        chain,
        transport: http(run.fork.rpc, { timeout: 60_000, retryCount: 0 }),
        account: testAccount(index),
      }),
    bemOf: (who) => pub.readContract({ address: bem, abi: erc20, functionName: "balanceOf", args: [who] }),
    heldOf: (who, item) => {
      const id = d.items[item];
      if (!id) throw new Error(`no item ${item} in the deployment`);
      return pub.readContract({
        address: d.outfitMarketV2,
        abi: erc1155,
        functionName: "balanceOf",
        args: [who, BigInt(id)],
      });
    },
    packsOf: async (who) => {
      const [room, looks] = await pub.readContract({
        address: d.extras,
        abi: extrasAbi,
        functionName: "extrasOf",
        args: [who],
      });
      return { room, looks };
    },
    colourOf: (petId) =>
      pub.readContract({ address: d.extras, abi: extrasAbi, functionName: "nameColour", args: [BigInt(petId)] }),
    extrasBurned: () => pub.readContract({ address: d.extras, abi: extrasAbi, functionName: "totalBurned" }),
    ownerOf: (petId) =>
      pub.readContract({ address: d.registry, abi: registryAbi, functionName: "ownerOf", args: [BigInt(petId)] }),
    brainOf: async (petId) =>
      (await pub.readContract({ address: d.registry, abi: registryAbi, functionName: "pet", args: [BigInt(petId)] }))
        .brainId,
    isKeeper: (petId, who) =>
      pub.readContract({ address: d.registry, abi: registryAbi, functionName: "isKeeper", args: [BigInt(petId), who] }),
    mine: async (n = 1) => {
      for (let i = 0; i < n; i++) await rpc("evm_mine", []);
    },
    setOkb: async (who, wei) => {
      await rpc("anvil_setBalance", [who, numberToHex(wei)]);
    },
    plain,
  };
}

/** A red packet made on the fork, with the one-time key its link carries (hex, no 0x). */
export interface MadePacket {
  id: bigint;
  key: string;
  sender: Address;
  opened: Address[];
}

/**
 * A lucky red packet of `shares` shares of 1 USDT each, made by test wallet `sender` and opened by each of
 * `openers` (claim, two blocks, reveal), through the same helpers the game uses. The sender's USDT is written into
 * the fork, as fork-packet.ts does.
 */
export async function makePacket(
  fork: Fork,
  o: { shares: number; sender: number; openers: number[] },
): Promise<MadePacket> {
  const d = fork.d as unknown as Deployment;
  const sender = fork.wallet(o.sender);
  for (const i of [o.sender, ...o.openers]) await fork.plain(testAccount(i).address);
  const total = BigInt(o.shares) * 1_000_000n;
  await fork.setOkb(sender.account!.address, 10n ** 18n);
  await giveToken(fork.pub, XLAYER_USDT, sender.account!.address, total);
  const key = generatePrivateKey();
  const { id } = await createPacket(fork.pub, sender, d, {
    token: XLAYER_USDT,
    total,
    count: o.shares,
    lifetimeSec: 86_400,
    key: privateKeyToAccount(key).address,
    lucky: true,
    petOwnersOnly: false,
  });
  const friends = o.openers.map((i) => fork.wallet(i));
  for (const f of friends)
    await claimPacket(fork.pub, f, d, id, await signClaim(fork.pub, d, key, id, f.account!.address));
  await fork.mine(2);
  for (const f of friends) await revealPacket(fork.pub, f, d, id);
  return { id, key: key.slice(2), sender: sender.account!.address, opened: friends.map((f) => f.account!.address) };
}

/** The pet's record of its twin on X Layer, as the game saves it (null before it is kept). */
export interface ChainRecord {
  petId: string;
  owner: string;
  autoUntil?: number;
  [k: string]: unknown;
}

export const chainRecord = (page: Page) =>
  page.evaluate(() => {
    const records = Object.values(
      JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { petId?: string } | null>,
    );
    return (records.find((r) => r && r.petId) ?? null) as ChainRecord | null;
  });

/**
 * Scrolls the open sheet until `selector` is on screen and returns it. Panels low in a sheet are drawn only once
 * they come near the screen, so the sheet is scrolled a step at a time until the panel exists and is in view.
 */
export async function reach(page: Page, selector: string): Promise<Locator> {
  const vh = page.viewportSize()?.height ?? 800;
  const scroll = (by: number | null) =>
    page.evaluate((by) => {
      document.querySelectorAll<HTMLElement>(".sheet, .sheet *").forEach((e) => {
        if (e.scrollHeight > e.clientHeight + 10) e.scrollTop = by === null ? 0 : e.scrollTop + by;
      });
    }, by);
  if (!(await page.locator(selector).count())) {
    await scroll(null);
    await page.waitForTimeout(200);
  }
  for (let i = 0; i < 90; i++) {
    const loc = page.locator(selector).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      if (
        box &&
        ((box.y >= 0 && box.y + Math.min(box.height, 120) <= vh) ||
          (box.height > vh * 0.6 && box.y < vh && box.y + box.height > 0))
      )
        return loc;
    }
    await scroll(300);
    await page.waitForTimeout(120);
  }
  throw new Error(`never reached ${selector} in the sheet`);
}

/** What the page shows about keeping, for a keep that never landed: the keep button, the sheet's status lines and
 * notes, the chain store's pending entry, and whether the page can still reach the fork. */
async function keepState(page: Page): Promise<string> {
  return page
    .evaluate(async () => {
      const keep = document.querySelector<HTMLButtonElement>("[data-hint=keep]");
      const sheet = document.querySelector<HTMLElement>(".sheet");
      const lines = [...(sheet?.querySelectorAll<HTMLElement>("[role=status], [role=alert], .note, .err") ?? [])]
        .map((x) => x.innerText.trim())
        .filter(Boolean);
      const pending = Object.keys(localStorage).filter((k) => /pending|chain/i.test(k));
      return JSON.stringify({
        keep: keep ? { text: keep.innerText.trim(), disabled: keep.disabled } : "gone",
        sheetOpen: !!sheet,
        lines: lines.slice(0, 8),
        stored: Object.fromEntries(pending.map((k) => [k, (localStorage.getItem(k) ?? "").slice(0, 300)])),
      });
    })
    .catch((x: unknown) => `(the page could not be read: ${String(x)})`);
}

/** Keeps the pet on screen on X Layer with the game's own button (the Pet sheet must be open); returns its record. */
export async function keepOnChain(page: Page): Promise<ChainRecord> {
  await (await reach(page, "[data-hint=keep]")).click();
  try {
    await page.waitForFunction(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { petId?: string } | null>,
        ).some((r) => r && r.petId),
      undefined,
      { timeout: 180_000 },
    );
  } catch (e) {
    // P7a: a keep that never lands says what the page showed when the wait ran out, not only that it ran out
    throw new Error(`the pet was never kept: ${await keepState(page)}`, { cause: e });
  }
  const record = await chainRecord(page);
  if (!record) throw new Error("the pet was kept but its record is gone");
  return record;
}

/** Waits until a status line inside `scope` matches `pattern`, and returns every status line there. */
export async function statusNote(
  page: Page,
  scope: string,
  pattern: RegExp | string,
  timeout = 120_000,
): Promise<string> {
  const source = typeof pattern === "string" ? pattern : pattern.source;
  const h = await page.waitForFunction(
    ([scope, pat]) => {
      const el = document.querySelector(scope!);
      if (!el) return false;
      const s = [...el.querySelectorAll<HTMLElement>("[role=status]")].map((x) => x.innerText).join(" | ");
      return new RegExp(pat!).test(s) ? s : false;
    },
    [scope, source],
    { timeout },
  );
  return (await h.jsonValue()) as string;
}

/** Adds a lesson to the active pet's save, as Pet School writes it, so the mind on chain falls behind. */
export const teach = (page: Page, lesson: { when: Record<string, number[]>; then: Record<string, number> }) =>
  page.evaluate((l) => {
    const s = JSON.parse(localStorage.getItem("lingxi.pets.v2") ?? "null") as {
      pets: Array<{ lessons?: unknown[] }>;
      active?: number;
    };
    const p = s.pets[s.active ?? 0]!;
    (p.lessons ??= []).push(l);
    localStorage.setItem("lingxi.pets.v2", JSON.stringify(s));
  }, lesson);
