/**
 * A38: a card carrying a brain too big to run neither freezes nor breaks another player's game. The crafted card is the
 * independent review's: an owned instinct of four levels of 55 REFs down to one gate, a 15 KB card that runs millions
 * of gates a beat (one step took 4.7 s before the fix). It arrives as a friend's card in a room, and as a duel link;
 * each time the game says the card is damaged, at once, and the page never stops drawing.
 */
import { randomBytes } from "node:crypto";
import { type Page } from "@playwright/test";
import { NAND, REF, bytesToHex, encode, type Element } from "../../packages/brain/src";
import { encodeChallenge } from "../../packages/game/src/duel";
import { type Address } from "viem";
import { quoteTapeout, tapeOutYourself } from "../../packages/chain/src/selftape";
import { INSTINCT_MAX_GATES } from "../../packages/game/src/family";
import { expect, hatch, sheet, test } from "../fixtures";
import { forkOf } from "../helpers/chain";
import { RoomSocket, keyedId, stored } from "../helpers/browser";
import { spotFor, tapVisitor } from "../helpers/room";

const cpu = `0x${"ab".repeat(20)}`;

/** The reviewer's instinct: each of four levels REFs the next 55 times, down to a one-gate leaf. */
function heavyCard(): string {
  const k = 55;
  const hex = (els: Element[]) => bytesToHex(encode(els)).slice(2);
  const refs = (nIn: number, to: bigint): Element[] => Array.from({ length: k }, (_, i) => ({ op: REF, ins: [2], cpu, id: to, nOut: 1, firstOut: 2 + nIn + i }) as Element);
  const parts = [{ processor: cpu, id: "1", nIn: 16, nOut: 8, hex: hex(refs(16, 2n)) }];
  for (let lvl = 2; lvl <= 4; lvl++) parts.push({ processor: cpu, id: String(lvl), nIn: 1, nOut: 1, hex: hex(refs(1, BigInt(lvl + 1))) });
  parts.push({ processor: cpu, id: "5", nIn: 1, nOut: 1, hex: hex([{ op: NAND, ins: [2, 2], nOut: 1, firstOut: 3 } as Element]) });
  return JSON.stringify({ lessons: [], outside: { processor: cpu, id: "1", owner: "", parts } });
}

/** Starts recording the longest pause between two drawn frames. */
const watchFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { longestPause: number };
    w.longestPause = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.longestPause = Math.max(w.longestPause, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const longestPause = (page: Page) => page.evaluate(() => (window as unknown as { longestPause: number }).longestPause);

test("a friend's card with a brain too big to run is said to be damaged, and the page keeps drawing (en, light, desktop)", async ({ player, run }) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "en", scheme: "light", size: "desktop", reducedMotion: true });
  const { page } = p;
  await hatch(p, "Kiri");
  const home = `home:${(await stored(page, "lingxi.player.v1"))!}`;
  const secret = randomBytes(16).toString("hex");
  const friendId = keyedId(secret);
  const friend = await RoomSocket.open(`${run.api.replace("http", "ws")}/live`, p.web);
  friend.hello(home, friendId, secret, "Mallory");
  await friend.next("room");
  friend.send({ t: "card", lessons: heavyCard() });
  await page.waitForTimeout(500);

  const card = page.locator(".visitor-card");
  for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
    await tapVisitor(page, spotFor(friendId), { nth: tries });
    await page.waitForTimeout(250);
  }
  await expect(card, "the friend's pet is picked").toBeVisible();
  await watchFrames(page);
  await card.getByRole("button", { name: "Spar" }).click();
  await expect(page.locator(".world-toast", { hasText: "Can't spar with that pet" }), "the card is said to be damaged").toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".sp-fight"), "and no fight is started with it").toHaveCount(0);
  expect(await longestPause(page), "the page never stopped drawing for long").toBeLessThan(1_000);
  await page.screenshot({ path: test.info().outputPath("heavy-card-en-light-desktop.png") });
  friend.close();
});

test("a duel link carrying a brain too big to run is said to be damaged, and the page keeps drawing (zh, dark, phone)", async ({ player }) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "phone", reducedMotion: true });
  const { page } = p;
  await hatch(p, "Momo");
  const code = encodeChallenge({ id: "abcdef0123456789", from: { name: "Evil", line: "gentle", stage: "adult", card: heavyCard(), story: { days: 9, lessons: 0, nature: [] } }, at: 1 });
  await watchFrames(page);
  // the link arrives on an open page, as one tapped in a chat does
  await page.evaluate((c) => (location.hash = `#duel=${c}`), code);
  const said = page.getByRole("dialog").filter({ hasText: "这个切磋链接坏了，打不开。" });
  await expect(said, "the link is said to be damaged").toBeVisible({ timeout: 5_000 });
  expect(await longestPause(page), "the page never stopped drawing for long").toBeLessThan(1_000);
  await page.screenshot({ path: test.info().outputPath("heavy-duel-zh-dark-phone.png") });
  await said.getByRole("button", { name: "好的" }).click();
  await expect(said).toHaveCount(0);
});

test("an owned circuit that runs more gates than an instinct may is not taught, and the screen says why (en light phone, then zh)", async ({ player, run }) => {
  test.setTimeout(480_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Pip");
  const fork = await forkOf(run);
  const PROCESSOR: Address = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e";
  const me = run.players.find((x) => x.web === p.web)!;
  const wallet = fork.wallet(me.index);

  // with the player's own wallet: a pet-shaped chain of NANDs, and a pet-shaped circuit that REFs it eight times
  const leafEls = Array.from({ length: INSTINCT_MAX_GATES / 8 + 1 }, (_, i) => ({ op: NAND, ins: i === 0 ? [2, 3] : [17 + i, 17 + i], nOut: 1, firstOut: 18 + i }) as Element);
  const leafBytes = encode(leafEls);
  const qLeaf = await quoteTapeout(fork.pub, PROCESSOR, me.address as Address, leafEls.length, 0, leafBytes.length);
  expect(qLeaf.enough, "the player's wallet can pay for a tape-out on the fork").toBe(true);
  const leaf = await tapeOutYourself(fork.pub, wallet, PROCESSOR, leafBytes, qLeaf);
  const inputs = Array.from({ length: 16 }, (_, i) => 2 + i);
  const topBytes = encode(Array.from({ length: 8 }, (_, i) => ({ op: REF, ins: inputs, cpu: PROCESSOR.toLowerCase(), id: leaf.brainId, nOut: 8, firstOut: 18 + 8 * i }) as Element));
  const top = await tapeOutYourself(fork.pub, wallet, PROCESSOR, topBytes, await quoteTapeout(fork.pub, PROCESSOR, me.address as Address, 0, 0, topBytes.length));

  await sheet(page, "mind");
  const panel = page.locator(".owned-instinct");
  await panel.getByRole("button", { name: "Connect a wallet to see your circuits" }).click();
  await panel.getByRole("textbox", { name: "Processor address" }).fill(PROCESSOR);
  await panel.getByRole("button", { name: "List my circuits" }).click();
  // the circuit's own number, in either language ("Circuit #25", "#25 号电路")
  const row = panel.locator(".owned-list li", { hasText: new RegExp(String.raw`#${top.brainId}(?!\d)`) });
  await row.waitFor({ timeout: 120_000 });
  const teachIt = row.getByRole("button");
  const said = `That circuit runs ${(INSTINCT_MAX_GATES + 8).toLocaleString("en")} gates each beat, more than an instinct may (${INSTINCT_MAX_GATES.toLocaleString("en")}): every friend who meets Pip would have to run it too.`;
  // the processor's own count marks it in the list when it counts the REFs; when it does not, teaching refuses it
  if (await teachIt.isEnabled()) {
    await teachIt.click();
    await expect(panel.locator(".sp-warn"), "teaching it is refused, and the screen says why").toHaveText(said, { timeout: 60_000 });
  } else {
    await expect(teachIt, "the list marks it").toHaveText("Too many gates");
    await expect(row.locator(".owned-why"), "and says why, on the page").toHaveText(said);
  }
  expect(JSON.parse((await stored(page, "lingxi.pets.v2"))!).pets[0].outside, "nothing was taught").toBeUndefined();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("owned-too-many-gates-en-light-phone.png") });

  // the same, in Chinese
  await page.locator("button.round-btn[lang]").dispatchEvent("click");
  if (await teachIt.isEnabled()) {
    await teachIt.click();
    await expect(panel.locator(".sp-warn")).toContainText(`超过本能的上限（${INSTINCT_MAX_GATES.toLocaleString("zh-CN")} 个）`, { timeout: 60_000 });
  } else {
    await expect(teachIt).toHaveText("门太多");
    await expect(row.locator(".owned-why")).toContainText(`超过本能的上限（${INSTINCT_MAX_GATES.toLocaleString("zh-CN")} 个）`);
  }
  await page.screenshot({ path: test.info().outputPath("owned-too-many-gates-zh-light-phone.png") });
});

