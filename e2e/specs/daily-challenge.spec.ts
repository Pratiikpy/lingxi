/**
 * A34: today's challenge, as a player meets it on the spar screen. The block that seeds it comes from the game's server,
 * which finds it once from X Layer mainnet; the browser never asks a public node (whose rate-limit replies drop their
 * CORS headers and showed as blocked requests in the console). The block is checked here against mainnet itself.
 */
import { createPublicClient, http } from "viem";
import { expect, hatch, sheet, test } from "../fixtures";

const PUBLIC_NODES = /^https:\/\/(xlayerrpc\.okx\.com|rpc\.xlayer\.tech)\//;
const mainnet = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 15_000, retryCount: 3 }) });

for (const look of [
  {
    lang: "en",
    scheme: "light",
    size: "phone",
    card: "Daily challenge",
    spar: "Spar",
    seed: "Seed from today's first X Layer block",
  },
  {
    lang: "zh",
    scheme: "dark",
    size: "desktop",
    card: "每日挑战",
    spar: "挑战",
    seed: "种子来自今天 X Layer 的第一个区块",
  },
] as const) {
  test(`today's challenge is seeded by the server's block, checked against mainnet, with no public node asked (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
  }) => {
    test.setTimeout(240_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const asked: string[] = [];
    p.page.on("request", (r) => PUBLIC_NODES.test(r.url()) && asked.push(r.url()));
    await hatch(p, "Ari");
    await sheet(p.page, "spar");

    const card = p.page.getByRole("region", { name: look.card });
    await expect(card, "the card names today's block").toContainText(look.seed, { timeout: 60_000 });
    const href = await card.getByRole("link").getAttribute("href");
    const block = Number(/\/block\/(\d+)$/.exec(href ?? "")?.[1]);
    expect(block, "a block number").toBeGreaterThan(0);

    // the source of truth: on X Layer mainnet it is the first block at or after today's midnight UTC
    const midnight = BigInt(Math.floor(Date.now() / 86_400_000) * 86_400);
    const [b, before] = await Promise.all([
      mainnet.getBlock({ blockNumber: BigInt(block) }),
      mainnet.getBlock({ blockNumber: BigInt(block - 1) }),
    ]);
    expect(
      b.timestamp >= midnight && before.timestamp < midnight,
      `block ${block} is the first of the day on mainnet`,
    ).toBe(true);
    await p.page.screenshot({ path: test.info().outputPath(`daily-${look.lang}-${look.scheme}-${look.size}.png`) });

    // the challenge starts from it
    const partner = (await card.locator("b").innerText()).split(/ vs | 对 /)[1]!.trim();
    await card.getByRole("button", { name: look.spar, exact: true }).click();
    await expect(p.page.locator(".sp-fight"), "the daily fight plays against today's partner").toContainText(partner, {
      timeout: 20_000,
    });
    expect(asked, "the browser asked no public node").toEqual([]);
  });
}
