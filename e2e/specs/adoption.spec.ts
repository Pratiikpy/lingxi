/**
 * P9: adoption, played end to end. Two players' pets make a family on X Layer (the A31 road); the little one's player
 * offers it at the adoption centre while it is young, signing its papers; a third player, with a wallet of their own,
 * finds it at the centre with its papers checked against X Layer, adopts it with BEM, and it comes home to them. X Layer
 * is read after: the little one belongs to the adopter, the price left the adopter's wallet, and the seller and the
 * co-parent were paid their shares.
 */
import { adoptionTerms } from "../../packages/chain/src/adoption";
import type { Deployment } from "../../packages/chain/src/registry";
import { expect, sheet, test } from "../fixtures";
import { stored, walletOf } from "../helpers/browser";
import { reach } from "../helpers/chain";
import { REGISTRY, childOf, familyOnChain, hatchEgg } from "../helpers/family";

test("a little one offered at the adoption centre is adopted by a third player with BEM (zh dark desktop offers, en light phone adopts) (P9)", async ({
  player,
  run,
}) => {
  test.setTimeout(1_500_000);
  const { a, b, fork, petA, petB, ask, yes } = await familyOnChain(
    player,
    run,
    {
      a: { lang: "zh", scheme: "dark", size: "desktop", reducedMotion: true },
      b: { lang: "en", scheme: "light", size: "phone", wallet: 1 },
    },
    { family: "家人", yes: "Yes" },
  );
  await yes.click();
  await expect(ask).toHaveCount(0, { timeout: 120_000 });

  // the pets have lived on chain for the Breeder's 7 days; the little one is born and welcomed home
  await fork.pub.request({ method: "evm_increaseTime" as never, params: [8 * 86_400] as never });
  await fork.pub.request({ method: "evm_mine" as never, params: [] as never });
  const born = a.page.locator(".fam-modal", { hasText: "一个小宝宝出生了" });
  await born.waitFor({ timeout: 60_000 });
  await born.locator(".fam-name input").fill("Bean");
  await born.getByRole("button", { name: "欢迎回家" }).click();
  // a birth X Layer confirms slowly (a fork reading cold state) is said to be sent and still confirming, and the
  // player is told to try again in a minute: the test does what the screen says, as a player would
  const retry = born.getByRole("button", { name: "再试一次" });
  for (let tries = 0; tries < 4; tries++) {
    const gone = await born
      .waitFor({ state: "detached", timeout: 240_000 })
      .then(() => true)
      .catch(() => false);
    if (gone) break;
    await expect(born, "a birth still confirming says so").toContainText("还在确认");
    await born.page().waitForTimeout(60_000);
    await retry.click();
  }
  await expect(born).toHaveCount(0, { timeout: 240_000 });
  const child = await childOf(a.page, [petA, petB]);
  expect(child, "the little one has its own record").toBeTruthy();

  // its player offers it at the centre while it is young: save, allow, list, sign its papers, leave them
  await sheet(a.page, "me");
  const form = await reach(a.page, ".adoption-offer");
  await form.locator("input").fill("1");
  await form.locator("button[type=submit]").click();
  const said = a.page.locator(".adoption [role=status]");
  await expect(said, "the offer is made").toHaveText("Bean正在领养中心等待。", { timeout: 300_000 });
  await a.page.screenshot({ path: test.info().outputPath("adoption-offered-zh-dark-desktop.png") });

  // a third player, with a wallet of their own, finds it with its papers checked against X Layer
  const c = await player({ lang: "en", scheme: "light", size: "phone", wallet: 2 });
  await hatchEgg(c.page, c.web, 2, "Kiko");
  await sheet(c.page, "me");
  await reach(c.page, ".adoption");
  const card = c.page.locator(".adoption-card", { hasText: "Bean" });
  await expect(card, "the little one is waiting at the centre").toBeVisible({ timeout: 120_000 });
  await expect(card, "its papers match X Layer").toContainText("Papers match X Layer");
  await expect(card).toContainText("child of Mochi and Tofu");
  await c.page.screenshot({ path: test.info().outputPath("adoption-centre-en-light-phone.png") });

  const [seller, coParent, adopter] = [walletOf(run, a), walletOf(run, b), walletOf(run, c)];
  const before = await Promise.all([seller, coParent, adopter].map((w) => fork.bemOf(w)));
  await card.getByRole("button", { name: "Adopt" }).click();
  await expect(c.page.locator(".adoption [role=status]"), "it comes home").toHaveText("Bean came home with you.", {
    timeout: 300_000,
  });
  await c.page.screenshot({ path: test.info().outputPath("adoption-adopted-en-light-phone.png") });
  // a pet that has changed hands is never offered again: the centre refuses it (AlreadyMoved), so the game does not
  // show the offer at all
  await expect(c.page.locator(".adoption-offer"), "an adopted pet is not offered for adoption").toHaveCount(0);

  // X Layer: the little one is the adopter's, and the price went where the centre says
  const owner = await fork.pub.readContract({
    address: fork.d.registry,
    abi: REGISTRY,
    functionName: "ownerOf",
    args: [BigInt(child)],
  });
  expect(owner.toLowerCase(), "the little one belongs to the adopter").toBe(adopter.toLowerCase());
  const after = await Promise.all([seller, coParent, adopter].map((w) => fork.bemOf(w)));
  // 1 BEM, in its 8 decimals; the split by the centre's own terms, as the game shows it
  const price = 100_000_000n;
  // the run's deployment record is the whole X Layer record, pointed at the fork (harness/run.ts); fork.d types only
  // the parts the helpers use
  const terms = await adoptionTerms(fork.pub, fork.d as unknown as Deployment);
  const burned = (price * BigInt(terms.feeBps) + 9_999n) / 10_000n;
  const toCoParent = (price * BigInt(terms.coParentBps)) / 10_000n;
  expect(before[2]! - after[2]!, "the adopter paid the price").toBe(price);
  expect(after[1]! - before[1]!, "the co-parent was paid its share").toBe(toCoParent);
  expect(after[0]! - before[0]!, "the seller was paid the rest").toBe(price - burned - toCoParent);

  // the adopter's device keeps the little one's chain record as theirs
  const records = JSON.parse((await stored(c.page, "lingxi.chain.v2"))!) as Record<
    string,
    { petId: string; owner: string }
  >;
  const mine = Object.values(records).find((x) => x.petId === child);
  expect(mine?.owner.toLowerCase(), "the adopter's game keeps it as theirs").toBe(adopter.toLowerCase());
});
