/**
 * A red packet's claims: a lucky packet of three shares is made on the fork and two other wallets open theirs. A
 * player who gets the link sees both earlier claims in the list of who opened it, read from the server's index of
 * the chain; opening the last share (claim, two blocks, reveal) puts their own claim on the list at once, from its
 * own receipt, and the packet on chain is then fully paid. A viewer who comes later sees all three, in Chinese.
 *
 * Not covered here: the on-chain copy of the game (no server), which says where the list lives instead of showing
 * it. That copy is a separate build served without the game's server, which this suite does not start.
 */
import { type Address, formatUnits } from "viem";
import { XLAYER_USDT, readPacket } from "../../packages/chain/src/redpacket";
import type { Deployment } from "../../packages/chain/src/registry";
import { type Opened, expect, hatch, test } from "../fixtures";
import { type MadePacket, forkOf, makePacket } from "../helpers/chain";

const usdtAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
/** the test wallet that makes the packet: a throwaway one, given its USDT on the fork */
const SENDER = 4;
/** the two wallets that open their shares before the player */
const OPENERS = [1, 2];

const linkOf = (pk: MadePacket) => `lxp1.${Buffer.from(JSON.stringify({ id: pk.id.toString(), key: pk.key, from: { name: "Mochi", line: "gentle" }, letter: "Happy new year!" })).toString("base64url")}`;
const serverClaims = async (api: string, id: bigint) => ((await (await fetch(`${api}/api/packets/${id}/claims`)).json()) as { claims?: unknown[] }).claims?.length ?? 0;

/** Unfolds the list of who opened the packet, if it is folded, and waits for `n` rows on screen. */
async function showClaims(p: Opened, n: number) {
  if ((await p.page.locator(".rp-claims").getAttribute("open")) === null) await p.page.locator(".rp-claims summary").click();
  await expect(p.page.locator(".rp-claims li")).toHaveCount(n);
  await expect(p.page.locator(".rp-claims li").last()).toBeVisible();
}

/** A fresh player with a pet, arriving by the packet's link; the packet opens over the room. */
async function arrive(p: Opened, pk: MadePacket) {
  await hatch(p, "Kiri");
  await p.page.goto(`${p.web}/play.html#packet=${linkOf(pk)}`);
  await p.page.locator(".rp-open").first().waitFor({ timeout: 60_000 });
  await expect(p.page.locator(".rp-card h3"), "the packet says who sent it").toContainText("Mochi");
}

test("a red packet's claims: two opened before, the player opens the last, a viewer sees all three (en light phone; zh dark desktop)", async ({ player, run }) => {
  test.setTimeout(5 * 60_000);
  const fork = await forkOf(run);
  const d = fork.d as unknown as Deployment;
  const packet = await makePacket(fork, { shares: 3, sender: SENDER, openers: OPENERS });
  const made = await readPacket(fork.pub, d, packet.id);
  expect([made.count, made.paid], "the packet on chain: three shares, two opened").toEqual([3, 2]);
  // the server indexes claims from the fork block onward: the player arrives once it has read both
  await expect.poll(() => serverClaims(run.api, packet.id), { message: "the server's index holds both claims", timeout: 90_000 }).toBe(2);

  await test.step("the player opens the last share and their claim joins the list (en, light, phone)", async () => {
    const p = await player({ lang: "en", scheme: "light", size: "phone" });
    const { page } = p;
    await arrive(p, packet);
    const summary = page.locator(".rp-claims summary");
    await expect(summary, "the list of who opened it shows both earlier claims, from the server").toHaveText("Who got what (2)");
    await showClaims(p, 2);
    await page.screenshot({ path: test.info().outputPath("packet-list-en-light-phone.png") });

    const me = run.players[0]!.address as Address;
    const before = await fork.pub.readContract({ address: XLAYER_USDT, abi: usdtAbi, functionName: "balanceOf", args: [me] });
    await page.locator(".rp-open").first().click();
    // a lucky share is decided by a block after the claim: the fork makes blocks only when asked
    await expect(page.locator(".rp-open").first(), "the claim is in and the game waits for the next blocks").toHaveText("Waiting for the next block to decide your luck…", { timeout: 60_000 });
    await fork.mine(2);
    await expect(summary, "the player's claim joins the list at once, from its own receipt").toHaveText("Who got what (3)", { timeout: 60_000 });
    const after = await fork.pub.readContract({ address: XLAYER_USDT, abi: usdtAbi, functionName: "balanceOf", args: [me] });
    await expect(page.locator(".rp-result b"), "the share shown is what reached the player's wallet on chain").toHaveText(`${formatUnits(after - before, 6)} USDT`);
    const opened = await readPacket(fork.pub, d, packet.id);
    expect([opened.claimed, opened.paid], "the packet on chain is now fully opened").toEqual([3, 3]);
    await showClaims(p, 3);
    await expect(page.locator(".rp-claims li", { hasText: `${me.slice(0, 6)}…${me.slice(-4)}` }), "the player's own claim is on the list").toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath("packet-opened-en-light-phone.png") });
  });

  await test.step("a viewer later sees all three claims, in Chinese (zh, dark, desktop)", async () => {
    await expect.poll(() => serverClaims(run.api, packet.id), { message: "the server's index holds all three claims", timeout: 90_000 }).toBe(3);
    const p = await player({ lang: "zh", scheme: "dark", size: "desktop" });
    const { page } = p;
    await arrive(p, packet);
    const summary = page.locator(".rp-claims summary");
    await expect(summary, "a viewer later sees all three, in Chinese").toHaveText("谁领了多少（3）");
    await expect(page.locator(".rp-open").first(), "nothing is left to open").toHaveText("已领完");
    await showClaims(p, 3);
    await page.screenshot({ path: test.info().outputPath("packet-list-zh-dark-desktop.png") });
  });
});
