/**
 * A31: a little one born on chain, as two players make it. Two grown pets that know each other well, each kept on
 * X Layer by its own player's wallet: one player proposes a family from the room, the other says yes and signs one
 * consent, and the little one is born through the Breeder, which burns the fee. The Breeder first refuses, since the
 * pets have lived on chain for less than its 7 days; the fork's clock moves on, and the birth goes through.
 *
 * Growing the pets takes days of game time, which a test cannot wait for: each pet's hatch time is moved back 9 days in
 * its own save, and the two are given the bond three meetings a day would build; everything on chain is done for real.
 *
 * A33: the Breeder records only the little one's mixed memory, so its first day is saved right after the birth; when
 * that save does not happen the birth stands, the player is told, and the Save button puts it right.
 */
import { parseAbi, toFunctionSelector } from "viem";
import { type Page } from "@playwright/test";
import { dismiss, expect, sheet, test } from "../fixtures";
import { keepOnChain, stored, walletOf } from "../helpers/browser";
import { forkOf } from "../helpers/chain";
import { spotFor, tapVisitor } from "../helpers/room";
import { unpackState } from "../../packages/game/src/pack";

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

type Fixtures = Parameters<Parameters<typeof test>[2]>[0];
type Look = Parameters<Fixtures["player"]>[0];

/**
 * Two players, each with a grown pet kept on X Layer by its own wallet, the pets knowing each other well: B visits A,
 * A asks for a family from B's card, and B's game shows the proposal checked on X Layer. Returns before B says yes.
 */
async function familyOnChain(player: Fixtures["player"], run: Fixtures["run"], looks: { a: Look; b: Look }, words: { family: string; yes: string }) {
  const a = await player(looks.a);
  const b = await player(looks.b);
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
    await tapVisitor(a.page, spotFor(idB), { own: "adult", nth: tries });
    await a.page.waitForTimeout(400);
  }
  await expect(card, "Tofu is picked in Mochi's room").toBeVisible();
  await card.getByRole("button", { name: words.family }).click();

  // Tofu's player sees the proposal checked on X Layer before Yes can be pressed
  const ask = b.page.locator(".fam-modal");
  await ask.waitFor({ timeout: 30_000 });
  await expect(ask, "the proposal says what of Tofu goes into the little one").toContainText("Tofu");
  const yes = ask.getByRole("button", { name: words.yes });
  await expect(yes, "the proposal is checked on X Layer before Yes can be pressed").toBeEnabled({ timeout: 60_000 });
  return { a, b, fork, petA, petB, ask, yes };
}

/** The little one's id: the chain record on A's device that is neither parent's. */
async function childOf(page: Page, parents: string[]): Promise<string> {
  const records = JSON.parse((await stored(page, "lingxi.chain.v2"))!) as Record<string, { petId: string }>;
  return Object.values(records).map((r) => r.petId).find((id) => !parents.includes(id))!;
}

/** The registry's record of a pet. */
const petOnChain = (fork: Awaited<ReturnType<typeof forkOf>>, id: string) => fork.pub.readContract({ address: fork.d.registry, abi: REGISTRY, functionName: "pet", args: [BigInt(id)] });

test("a little one is born on chain from two players' grown pets (zh dark desktop proposes, en light phone agrees)", async ({ player, run }) => {
  test.setTimeout(900_000);
  const { a, b, fork, petA, petB, ask, yes } = await familyOnChain(player, run, { a: { lang: "zh", scheme: "dark", size: "desktop", reducedMotion: true }, b: { lang: "en", scheme: "light", size: "phone", wallet: 1 } }, { family: "家人", yes: "Yes" });
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
  const child = await childOf(a.page, [petA, petB]);
  expect(child, "the little one has its own record").toBeTruthy();
  expect(await fork.bemOf(walletOf(run, a)), "the fee was paid in BEM").toBeLessThan(bemBefore);
  const onChain = await petOnChain(fork, child);
  expect([onChain.parentA.toString(), onChain.parentB.toString()].sort(), "its parents on chain are Mochi and Tofu").toEqual([petA, petB].sort());

  // its first day was saved right after the birth: X Layer holds the baby it is, not an egg of zeros (A33)
  expect(onChain.day, "its first day is saved").toBe(1);
  const state = unpackState(onChain.state, onChain.brainBits);
  expect(state.stage, "a baby on chain, not an egg").toBe("baby");
  expect(state.line, "of its own line").toBe("gentle");
  expect(Object.values(state.meters).every((m) => m > 0), "with its own meters").toBe(true);

  // its proof page names its parents, says its brain is still the one checked at birth (A24), and shows its state
  await a.page.goto(`${a.web}/verify.html#${child}`);
  await expect(a.page.locator(".v-lineage"), "the proof page says its brain is still the circuit checked at birth").toContainText("它现在的大脑仍是那块电路", { timeout: 120_000 });
  await expect(a.page.locator(".v-unsaved"), "a saved little one is not called unsaved").toHaveCount(0);
  await a.page.screenshot({ path: test.info().outputPath("birth-proof-zh-dark-desktop.png"), fullPage: true });
});

test("a little one whose first day does not save is still born, and its player is told how to put it right (en light phone proposes, zh dark desktop agrees)", async ({ player, run }) => {
  test.setTimeout(900_000);
  const { a, fork, petA, petB, ask, yes } = await familyOnChain(player, run, { a: { lang: "en", scheme: "light", size: "phone" }, b: { lang: "zh", scheme: "dark", size: "desktop", wallet: 1 } }, { family: "Family", yes: "好呀" });
  await yes.click();
  await expect(ask).toHaveCount(0, { timeout: 120_000 });

  // the pets have lived on X Layer for longer than the Breeder's 7 days
  await fork.pub.request({ method: "evm_increaseTime" as never, params: [8 * 86_400] as never });
  await fork.pub.request({ method: "evm_mine" as never, params: [] as never });
  const born = a.page.locator(".fam-modal", { hasText: "A little one is born!" });
  await born.waitFor({ timeout: 60_000 });
  await expect(born, "the second signature is said before Welcome is pressed").toContainText("Then your wallet asks once more, to save its first day there");
  await born.locator(".fam-name input").fill("Bean");

  // the first day's save is lost on its way to X Layer (only that transaction: the birth goes through)
  const save = toFunctionSelector("checkpoint(uint256,uint32,uint256,bytes32)").slice(2);
  await a.page.route(
    (u) => u.href.startsWith(run.fork.rpc),
    async (route) => {
      const sent = JSON.parse(route.request().postData() ?? "null") as unknown;
      const calls = (Array.isArray(sent) ? sent : [sent]) as Array<{ id?: number; method?: string; params?: unknown[] } | null>;
      if (!calls.some((c) => c?.method === "eth_sendRawTransaction" && String(c.params?.[0] ?? "").toLowerCase().includes(save))) return route.continue();
      const refused = calls.map((c) => ({ jsonrpc: "2.0", id: c?.id ?? null, error: { code: -32000, message: "lost on its way (the test)" } }));
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(Array.isArray(sent) ? refused : refused[0]) });
    },
  );
  await born.getByRole("button", { name: "Welcome home" }).click();
  const told = a.page.locator(".fam-unsaved");
  await expect(told, "the player is told its first day is not on chain, and how to put it right").toContainText("Its first day isn't saved there yet", { timeout: 240_000 });
  await expect(told).toContainText('press "Save today on chain"');
  await a.page.screenshot({ path: test.info().outputPath("birth-unsaved-en-light-phone.png") });
  // the same words in Chinese (the language button sits under the dialog's scrim, so it is pressed directly)
  const language = a.page.locator("button.round-btn[lang]");
  await language.dispatchEvent("click");
  await expect(told).toContainText("只是它的第一天还没存到链上");
  await expect(told).toContainText("点「把今天存上链」");
  await a.page.screenshot({ path: test.info().outputPath("birth-unsaved-zh-light-phone.png") });
  await language.dispatchEvent("click");
  await expect(told).toContainText("Its first day isn't saved there yet");
  const child = await childOf(a.page, [petA, petB]);
  expect((await petOnChain(fork, child)).day, "born, its first day not saved").toBe(0);
  await a.page.locator(".fam-modal").getByRole("button", { name: "OK" }).click();
  await a.page.unrouteAll({ behavior: "wait" });

  // its proof page says so, and does not show the egg's zeros as its state
  await a.page.goto(`${a.web}/verify.html#${child}`);
  await expect(a.page.locator(".v-unsaved"), "the proof page names a little one never saved").toContainText(`Born on X Layer from #${petA} and #${petB}, and its first day is not saved yet`, { timeout: 120_000 });
  await expect(a.page.locator(".v-picture img"), "PetLook's picture, an egg until a day is saved").toBeVisible({ timeout: 60_000 });
  await expect(a.page.locator(".v-picture img")).toHaveJSProperty("complete", true);
  await a.page.screenshot({ path: test.info().outputPath("birth-proof-unsaved-en-light-phone.png"), fullPage: true });
  await a.page.locator(".v-lang").click();
  await expect(a.page.locator(".v-unsaved")).toContainText(`由 #${petA} 和 #${petB} 在 X Layer 上生下，它的第一天还没保存`);
  await a.page.screenshot({ path: test.info().outputPath("birth-proof-unsaved-zh-light-phone.png") });
  await a.page.locator(".v-lang").click();

  // the Save button puts it right
  await a.page.goto(`${a.web}/play.html`);
  await a.page.locator(".stage").waitFor();
  await dismiss(a.page);
  await sheet(a.page, "me");
  await a.page.getByRole("button", { name: "Save today on chain" }).click();
  await expect.poll(async () => (await petOnChain(fork, child)).day, { timeout: 240_000, message: "the Save button saves its first day" }).toBe(1);
  const after = await petOnChain(fork, child);
  expect(unpackState(after.state, after.brainBits).stage).toBe("baby");
  await a.page.goto(`${a.web}/verify.html#${child}`);
  await expect(a.page.locator(".v-lineage")).toBeVisible({ timeout: 120_000 });
  await expect(a.page.locator(".v-unsaved"), "saved now, so no longer called unsaved").toHaveCount(0);
});
