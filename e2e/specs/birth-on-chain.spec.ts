/**
 * A31: a little one born on chain, as two players make it. Two grown pets that know each other well, each kept on
 * X Layer by its own player's wallet: one player proposes a family from the room, the other says yes and signs one
 * consent, and the little one is born through the Breeder, which burns the fee. The Breeder first refuses, since the
 * pets have lived on chain for less than its 7 days; the fork's clock moves on, and the birth goes through.
 *
 * Growing the pets takes days of game time, which a test cannot wait for: each pet's hatch time is moved back 9 days in
 * its own save, and the two are given the bond three meetings a day would build; everything on chain is done for real.
 */
import { parseAbi } from "viem";
import { type Page } from "@playwright/test";
import { dismiss, expect, sheet, test } from "../fixtures";
import { keepOnChain, stored, walletOf } from "../helpers/browser";
import { forkOf } from "../helpers/chain";
import { spotFor, tapScene } from "../helpers/room";

const DAY = 86_400_000;
const REGISTRY = parseAbi([
  "function pet(uint256 id) view returns ((address processor, uint64 brainId, uint8 line, uint8 brainBits, uint32 day, uint40 born, uint40 checkedAt, bytes32 logHash, uint256 state, uint128 parentA, uint128 parentB))",
  "function ownerOf(uint256 id) view returns (address)",
]);

/** Hatches a pet from the egg at `egg` and names it. */
async function hatchEgg(page: Page, web: string, egg: number, name: string): Promise<void> {
  await page.goto(`${web}/play.html`);
  await page.locator(".hatch").waitFor({ timeout: 60_000 });
  await page.locator(".eggs .egg").nth(egg).click();
  await page.fill("#pet-name", name);
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
}

/**
 * Days of game time, in the save: the pet's hatch time moves back `days`, and it knows the friend (its player's id and
 * pet's name) at the bond a family needs. Written by a script that runs before the game's own on the next load, so the
 * page leaving cannot write the old save over it.
 */
async function grownAndBonded(page: Page, days: number, friend: { id: string; name: string; line: string }): Promise<void> {
  await page.addInitScript(
    ({ ms, friend }) => {
      if (sessionStorage.getItem("a31.grown")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<{ bornAt: number }> };
      const bornAt = save.pets[0]!.bornAt - ms;
      save.pets[0]!.bornAt = bornAt;
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      const now = Date.now();
      const friends = { [String(bornAt)]: { [`${friend.id}:${friend.name}`]: { name: friend.name, line: friend.line, points: 60, day: 0, today: 0, first: now - ms, last: now } } };
      localStorage.setItem("lingxi.friends.v1", JSON.stringify(friends));
      sessionStorage.setItem("a31.grown", "1");
    },
    { ms: days * DAY, friend },
  );
  await page.reload();
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
}

test("a little one is born on chain from two players' grown pets (zh dark desktop proposes, en light phone agrees)", async ({ player, run }) => {
  test.setTimeout(900_000);
  const a = await player({ lang: "zh", scheme: "dark", size: "desktop", reducedMotion: true });
  const b = await player({ lang: "en", scheme: "light", size: "phone", wallet: 1 });
  const fork = await forkOf(run);

  await hatchEgg(a.page, a.web, 0, "Mochi");
  await hatchEgg(b.page, b.web, 1, "Tofu");
  const idA = (await stored(a.page, "lingxi.player.v1"))!;
  const idB = (await stored(b.page, "lingxi.player.v1"))!;
  await grownAndBonded(a.page, 9, { id: idB, name: "Tofu", line: "bold" });
  await grownAndBonded(b.page, 9, { id: idA, name: "Mochi", line: "gentle" });

  // each keeps its pet on X Layer with its own wallet
  await sheet(a.page, "me");
  const petA = await keepOnChain(a, run);
  await a.page.keyboard.press("Escape");
  await sheet(b.page, "me");
  const petB = await keepOnChain(b, run);
  await b.page.keyboard.press("Escape");
  expect((await fork.pub.readContract({ address: fork.d.registry, abi: REGISTRY, functionName: "ownerOf", args: [BigInt(petA)] })).toLowerCase()).toBe(walletOf(run, a).toLowerCase());

  // Tofu visits Mochi's home; Mochi's player asks for a family from the visitor's card
  await b.page.goto(`${b.web}/play.html?visit=${idA}`);
  await b.page.locator(".stage").waitFor();
  await dismiss(b.page);
  const card = a.page.locator(".visitor-card");
  for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
    await tapScene(a.page, spotFor(idB), 96);
    await a.page.waitForTimeout(400);
  }
  await expect(card, "Tofu is picked in Mochi's room").toBeVisible();
  await card.getByRole("button", { name: "家人" }).click();

  // Tofu's player sees the proposal checked on X Layer, says yes and signs one consent
  const ask = b.page.locator(".fam-modal");
  await ask.waitFor({ timeout: 30_000 });
  await expect(ask, "the proposal says what of Tofu goes into the little one").toContainText("Tofu");
  const yes = ask.getByRole("button", { name: "Yes" });
  await expect(yes, "the proposal is checked on X Layer before Yes can be pressed").toBeEnabled({ timeout: 60_000 });
  await b.page.screenshot({ path: test.info().outputPath("birth-proposal-en-light-phone.png") });
  await yes.click();
  await expect(ask).toHaveCount(0, { timeout: 120_000 });

  // Mochi's player meets the newborn: what it inherits is said before it is welcomed
  const born = a.page.locator(".fam-modal", { hasText: "一个小宝宝出生了" });
  await born.waitFor({ timeout: 60_000 });
  await expect(born.locator(".fam-inherits"), "the newborn screen names both parents' lessons").toContainText("它继承了父母完整的心智");
  await born.locator(".fam-name input").fill("Bean");
  const bemBefore = await fork.bemOf(walletOf(run, a));

  // the Breeder refuses: neither pet has lived on chain for its 7 days
  await born.getByRole("button", { name: "欢迎回家" }).click();
  await expect(born, "the refusal says why").toContainText("在链上，两只宠物都要上链满 7 天才算长大。", { timeout: 180_000 });
  expect(await fork.bemOf(walletOf(run, a)), "nothing was burned for a refused birth").toBe(bemBefore);
  await a.page.screenshot({ path: test.info().outputPath("birth-refused-zh-dark-desktop.png") });

  // eight days pass on X Layer; the birth goes through and the fee is burned
  await fork.pub.request({ method: "evm_increaseTime" as never, params: [8 * 86_400] as never });
  await fork.pub.request({ method: "evm_mine" as never, params: [] as never });
  await born.getByRole("button", { name: "再试一次" }).click();
  await expect(born).toHaveCount(0, { timeout: 240_000 });
  const records = JSON.parse((await stored(a.page, "lingxi.chain.v2"))!) as Record<string, { petId: string }>;
  const child = Object.values(records).map((r) => r.petId).find((id) => id !== petA && id !== petB)!;
  expect(child, "the little one has its own record").toBeTruthy();
  expect(await fork.bemOf(walletOf(run, a)), "the fee was paid in BEM").toBeLessThan(bemBefore);
  const onChain = await fork.pub.readContract({ address: fork.d.registry, abi: REGISTRY, functionName: "pet", args: [BigInt(child)] });
  expect([onChain.parentA.toString(), onChain.parentB.toString()].sort(), "its parents on chain are Mochi and Tofu").toEqual([petA, petB].sort());

  // its proof page names its parents and says its brain is still the one checked at birth (A24)
  await a.page.goto(`${a.web}/verify.html#${child}`);
  await expect(a.page.locator(".v-lineage"), "the proof page says its brain is still the circuit checked at birth").toContainText("它现在的大脑仍是那块电路", { timeout: 120_000 });
  await a.page.screenshot({ path: test.info().outputPath("birth-proof-zh-dark-desktop.png"), fullPage: true });
});
