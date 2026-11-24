/**
 * H8, the two fee rails, played on the fork. A creator draws two pieces in the studio and publishes one priced in OKB
 * and one in BEM, choosing the coin with the studio's own buttons. A second player, on another device in Chinese, buys
 * a copy of each through the fashion market. Each purchase is read back from the chain: the OKB piece's 3% owed to
 * the project wallet (the first market's treasury), the BEM piece's 3% at the dead address. Then the live numbers show
 * what the project earned, and the independent recount, run against this server and this fork, agrees with every
 * number on the page.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, parseAbi, parseEther } from "viem";
import { type Opened, expect, hatch, sheet, test } from "../fixtures";
import { DEAD, type Fork, forkOf, reach, statusNote } from "../helpers/chain";

const ROOT = join(__dirname, "../..");
const marketAbi = parseAbi([
  "function owed(address) view returns (uint256)",
  "function treasury() view returns (address)",
]);
const OKB_PRICE = parseEther("0.002");
/** 0.5 BEM (8 decimals) */
const BEM_PRICE = 50_000_000n;

/** Draws a small piece on the studio's grid and names it. */
async function draw(p: Opened, name: string) {
  const studio = await reach(p.page, ".studio");
  for (const cell of ["2,1", "1,2", "2,2", "3,2", "2,3"])
    await studio.locator(`.studio-cell[aria-label='${cell}']`).dispatchEvent("pointerdown");
  await studio.locator(".studio-row input").fill(name);
}

/** Publishes the piece on screen in `coin`, at `price` per copy, with the studio's own buttons; returns its number. */
async function publish(p: Opened, coin: "BEM" | "OKB", price: string): Promise<string> {
  const studio = p.page.locator(".studio");
  const terms = studio.locator(".studio-publish");
  if (!(await terms.evaluate((d) => (d as HTMLDetailsElement).open))) await terms.locator("summary").click();
  await terms.locator(".studio-coin [role=radio]", { hasText: coin }).click();
  await expect(terms, `${coin}: the terms say where its 3% goes`).toContainText(
    coin === "BEM" ? "3% of every sale is burned" : "3% of every sale goes to the project",
  );
  await terms.locator(".studio-terms input").first().fill(price);
  await terms.locator(".studio-terms input").nth(1).fill("10");
  await terms.locator("button.btn.primary").click();
  const note = await statusNote(p.page, ".studio", /Published as market piece #\d+/, 180_000);
  return note.match(/#(\d+)/)![1]!;
}

test("the two fee rails: an OKB piece pays the project, a BEM piece is burned, and the numbers and the recount agree", async ({
  player,
  run,
}) => {
  test.setTimeout(35 * 60_000);
  const fork: Fork = await forkOf(run);
  const okbMarket = fork.d.outfitMarket as Address;
  const treasury = (await fork.pub.readContract({
    address: okbMarket,
    abi: marketAbi,
    functionName: "treasury",
  })) as Address;
  const project = (fork.d.deployer as string).toLowerCase();
  expect(treasury.toLowerCase(), "the OKB market pays the project wallet").toBe(project);
  const owed = () =>
    fork.pub.readContract({
      address: okbMarket,
      abi: marketAbi,
      functionName: "owed",
      args: [treasury],
    }) as Promise<bigint>;

  const creator = await player({ lang: "en", scheme: "light", size: "phone", wallet: 0 });
  await test.step("the creator publishes one piece in OKB and one in BEM (en, light, phone)", async () => {
    await hatch(creator, "Mochi");
    await sheet(creator.page, "me");
    await draw(creator, "Ember crown");
    await publish(creator, "OKB", "0.002");
    await draw(creator, "Ember staff");
    await publish(creator, "BEM", "0.5");
  });

  const buyer = await player({ lang: "zh", scheme: "dark", size: "desktop", wallet: 1 });
  await test.step("another player buys a copy of each in the fashion market (zh, dark, desktop)", async () => {
    await hatch(buyer, "Kiri");
    await sheet(buyer.page, "me");
    const market = await reach(buyer.page, ".fashion");
    await market.locator(".row .btn").first().click();
    for (const [name, check] of [
      [
        "Ember crown",
        async (before: { owed: bigint; dead: bigint }) =>
          expect((await owed()) - before.owed, "the OKB piece's 3% is owed to the project wallet").toBe(
            (OKB_PRICE * 300n) / 10_000n,
          ),
      ],
      [
        "Ember staff",
        async (before: { owed: bigint; dead: bigint }) =>
          expect((await fork.bemOf(DEAD)) - before.dead, "the BEM piece's 3% is at the dead address").toBe(
            (BEM_PRICE * 300n + 9_999n) / 10_000n,
          ),
      ],
    ] as const) {
      const card = buyer.page.locator(".fashion-card", { hasText: name });
      await expect(card, `${name} is for sale`).toBeVisible({ timeout: 120_000 });
      const before = { owed: await owed(), dead: await fork.bemOf(DEAD) };
      await card.locator(".fashion-actions .btn.primary").first().click();
      await expect(card, `${name}: the copy is the buyer's`).toContainText("你有 1 份", { timeout: 180_000 });
      await check(before);
    }
  });

  await test.step("the live numbers show what the project earned (zh, dark, desktop)", async () => {
    await buyer.page.goto(`${buyer.web}/numbers.html`);
    const earned = buyer.page.locator("section, .numbers-group, div").filter({ hasText: "项目的收入" }).last();
    // the server counts every sale since the fork's block; the numbers are read again each minute
    await expect
      .poll(async () => (await buyer.page.locator("body").innerText()).includes("0.00006 OKB"), {
        message: "earned: 3% of 0.002 OKB",
        timeout: 240_000,
        intervals: [10_000],
      })
      .toBe(true);
    await expect(earned).toContainText("来自 OKB 衣服市场");
  });

  await test.step("the recount, by its own path from this fork, agrees with every number on the page", async () => {
    const d = JSON.parse(readFileSync(join(ROOT, "packages/chain/deployments/xlayer.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const file = join(run.dir, "recount-deployment.json");
    // the server counts the markets from the fork's block, so the recount does too, and it reads the test server's team
    // file, not this machine's (P3a); the shops' burns are summed over
    // their whole history (to equal each contract's total), which through a fork can take a quarter of an hour
    writeFileSync(
      file,
      JSON.stringify({
        ...d,
        rpc: run.fork.rpc,
        outfitMarketBlock: run.fork.block,
        outfitMarketV2Block: run.fork.block,
      }),
    );
    const r = spawnSync(
      process.execPath,
      [
        join(ROOT, "node_modules/tsx/dist/cli.mjs"),
        "scripts/recount-numbers.ts",
        "--deployment",
        file,
        "--api",
        run.api,
        "--rpc",
        run.fork.rpc,
        "--registry-from",
        String(run.fork.block),
        "--team-file",
        join(run.dir, "stores", "team.json"),
      ],
      { cwd: join(ROOT, "packages/chain"), encoding: "utf8", timeout: 1_200_000 },
    );
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out, "the recount checks the project's earnings").toMatch(/same {2}OKB earned by the project/);
    expect(
      out.split("\n").filter((l) => l.startsWith("DIFFERENT")),
      out.slice(-3000),
    ).toEqual([]);
    expect(r.status, out.slice(-2000)).toBe(0);
  });

  expect(creator.errors, "no console errors for the creator").toEqual([]);
  expect(buyer.errors, "no console errors for the buyer").toEqual([]);
});
