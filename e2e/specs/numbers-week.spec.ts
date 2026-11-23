/**
 * H10, the numbers page that is honest and alive, played on the fork. One player keeps their pet on X Layer for free
 * (Lingxi's relayer sends the hatch), another keeps theirs with their own wallet. The live numbers then count the week's
 * activity, tell the two keeps apart by who sent each hatch, and count the circuits taped out on Lingxi's processor; the
 * page shows them in both languages; and the independent recount, by its own path from this fork, agrees with every one.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { type Address } from "viem";
import { STARTERS, compileProgram, netlistBytes } from "../../packages/brain/src";
import { quoteTapeout, tapeOutYourself } from "../../packages/chain/src/selftape";
import { expect, hatch, sheet, test } from "../fixtures";
import { chainRecord, forkOf, keepOnChain, reach } from "../helpers/chain";

const ROOT = join(__dirname, "../..");

type Live = {
  week: { hatched: number; saves: number; petsSaved: number; hatchers: number; circuits: number | null } | null;
  kept: { own: number; sponsored: number; other: number } | null;
  circuits: { total: number; minted: number; last7d: number | null } | null;
};

async function live(api: string): Promise<Live> {
  return (await (await fetch(`${api}/api/numbers?fresh=${Date.now()}`)).json()) as Live;
}

/** Marks the story quest "First lesson" handed in, which is what makes a free keep on offer, then reloads. */
async function firstLessonHandedIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { quests?: { active: Record<string, unknown>; done: Record<string, number> } };
    const book = w.quests ?? { active: {}, done: {} };
    w.quests = { ...book, done: { ...book.done, q10: Date.now() } };
    localStorage.setItem("lingxi.world.v1", JSON.stringify(w));
  });
  await page.reload();
  await page.locator(".stage").waitFor();
}

test("the numbers page counts the week, tells a free keep from an own-wallet keep, and the recount agrees (H10)", async ({ player, run }) => {
  test.setTimeout(40 * 60_000);
  // the baseline, once the processor's week count has been read (it is null only while that first read is under way)
  let before = await live(run.api);
  await expect.poll(async () => ((before = await live(run.api)), before.circuits?.last7d ?? null), { message: "the week's circuits are counted", timeout: 120_000, intervals: [5_000] }).not.toBeNull();
  expect(before.kept, "who kept each pet is served").not.toBeNull();
  expect(before.circuits, "the circuits taped out are served").not.toBeNull();

  const free = await player({ lang: "en", scheme: "light", size: "phone" });
  await test.step("a pet kept for free: Lingxi's relayer sends the hatch", async () => {
    await hatch(free, "Momo");
    await firstLessonHandedIn(free.page);
    await sheet(free.page, "me");
    const offer = await reach(free.page, "[data-hint=keep]");
    await expect(offer).toHaveText("Keep Momo on X Layer, free");
    await offer.click();
    await free.page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { petId?: string } | null>).some((r) => r && r.petId), undefined, { timeout: 240_000 });
    expect((await chainRecord(free.page))?.device, "kept for this device's key").toBe(true);
  });

  const own = await player({ lang: "zh", scheme: "dark", size: "desktop", wallet: 0 });
  await test.step("a pet kept with the player's own wallet", async () => {
    await hatch(own, "Lulu");
    await sheet(own.page, "me");
    const record = await keepOnChain(own.page);
    expect(record.device ?? false, "kept by the wallet, not a device key").toBe(false);
  });

  await test.step("a circuit taped out on Lingxi's processor with a player's own wallet", async () => {
    // a pet whose mind is already on chain reuses it, so a keep may tape nothing new: this tape-out always mints one
    const fork = await forkOf(run);
    const me = run.players[2]!;
    const net = compileProgram(STARTERS.gentle);
    const bytes = netlistBytes(net);
    const processor = fork.d.processor as Address;
    const q = await quoteTapeout(fork.pub, processor, me.address as Address, net.gates.length, net.latches.length, bytes.length);
    expect(q.enough, "the player's wallet can pay for a tape-out on the fork").toBe(true);
    await tapeOutYourself(fork.pub, fork.wallet(me.index), processor, bytes, q);
  });

  let after: Live = before;
  await test.step("the live numbers count both keeps apart, the week's hatches, and the circuits taped out", async () => {
    await expect
      .poll(async () => ((after = await live(run.api)), [after.kept!.own - before.kept!.own, after.kept!.sponsored - before.kept!.sponsored]), { message: "one more own-wallet keep and one more sponsored keep", timeout: 300_000, intervals: [10_000] })
      .toEqual([1, 1]);
    expect(after.kept!.other, "no pet counted as kept by a stranger").toBe(before.kept!.other);
    expect(after.week!.hatched - before.week!.hatched, "both hatches fall in the last 7 days").toBe(2);
    expect(after.week!.hatchers, "two wallets hatched this week").toBeGreaterThanOrEqual(2);
    await expect.poll(async () => ((after = await live(run.api)), after.circuits!.minted - before.circuits!.minted), { message: "the keeps' circuits were walked", timeout: 300_000, intervals: [10_000] }).toBeGreaterThanOrEqual(1);
    expect(after.circuits!.total, "the processor's own count is at least the circuits walked since the fork").toBeGreaterThanOrEqual(after.circuits!.minted);
    // the week's count is the processor's own (C7): on a fork of mainnet it holds the real week's circuits too, so it
    // grows by exactly the circuits taped out here, and is never below them (P3a)
    expect(after.circuits!.last7d! - before.circuits!.last7d!, "the week's count grows by the circuits taped out here").toBe(after.circuits!.minted - before.circuits!.minted);
    expect(after.circuits!.last7d!, "the week holds at least what was walked since the fork").toBeGreaterThanOrEqual(after.circuits!.minted);
    expect(after.week!.circuits).toBe(after.circuits!.last7d);
  });

  await test.step("the page shows them, in English (light, phone) and Chinese (dark, desktop)", async () => {
    await free.page.goto(`${free.web}/numbers.html`);
    await expect(free.page.getByRole("heading", { name: "The last 7 days" })).toBeVisible({ timeout: 60_000 });
    await expect(free.page.getByText("Kept by their owner's own wallet", { exact: true })).toBeVisible();
    await expect(free.page.getByText("Kept for them by Lingxi (free)", { exact: true })).toBeVisible();
    await expect(free.page.getByRole("heading", { name: "Circuits on Lingxi's processor" })).toBeVisible();
    // C2: on the fork the players are the harness's wallets, not the team's: the page tells their activity apart
    await expect(free.page.getByRole("heading", { name: "Whose activity this is" })).toBeVisible();
    await expect(free.page.getByText(/Players outside the team have hatched \d+ pets?/)).toBeVisible();
    await free.page.screenshot({ path: test.info().outputPath("numbers-week-en-light-phone.png"), fullPage: true });
    await own.page.goto(`${own.web}/numbers.html`);
    await expect(own.page.getByRole("heading", { name: "过去 7 天" })).toBeVisible({ timeout: 60_000 });
    await expect(own.page.getByText("由主人自己的钱包留在链上", { exact: true })).toBeVisible();
    await expect(own.page.getByText("由灵犀免费代为上链", { exact: true })).toBeVisible();
    await expect(own.page.getByRole("heading", { name: "灵犀处理器上的电路" })).toBeVisible();
    await own.page.screenshot({ path: test.info().outputPath("numbers-week-zh-dark-desktop.png"), fullPage: true });
    for (const p of [free.page, own.page]) expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);
  });

  await test.step("the recount, by its own path from this fork, agrees with every number", async () => {
    const d = JSON.parse(readFileSync(join(ROOT, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<string, unknown>;
    const file = join(run.dir, "recount-deployment-h10.json");
    writeFileSync(file, JSON.stringify({ ...d, rpc: run.fork.rpc, outfitMarketBlock: run.fork.block, outfitMarketV2Block: run.fork.block }));
    const r = spawnSync(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), "scripts/recount-numbers.ts", "--deployment", file, "--api", run.api, "--rpc", run.fork.rpc, "--registry-from", String(run.fork.block), "--team-file", join(run.dir, "stores", "team.json")], { cwd: join(ROOT, "packages/chain"), encoding: "utf8", timeout: 1_500_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    for (const line of [/same {2}the team's pets hatched/, /same {2}OKB market distinct player wallets that bought/, /same {2}pets kept by their owner's own wallet/, /same {2}pets kept by Lingxi's relayer/, /same {2}pets hatched in the last 7 days/, /same {2}circuits minted on the processor/, /same {2}circuits taped out in the last 7 days/, /same {2}circuits taped out \(the processor's nextId, its latest circuit id\)/, /same {2}every circuit minted since block/])
      expect(out, `the recount checks: ${line.source}`).toMatch(line);
    expect(out.split("\n").filter((l) => l.startsWith("DIFFERENT")), out.slice(-3000)).toEqual([]);
    expect(r.status, out.slice(-2000)).toBe(0);
  });

  expect(free.errors, "no console errors (en)").toEqual([]);
  expect(own.errors, "no console errors (zh)").toEqual([]);
});
