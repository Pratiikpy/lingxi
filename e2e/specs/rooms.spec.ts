/**
 * The rooms against a hostile visitor: a raw socket to the server's rooms, speaking the protocol directly. An impostor
 * using a player's id (anyone in a room can see it) without its key is refused, and nothing it says reaches the room
 * as that player. A family proposal naming a wallet that does not own the pet is caught on X Layer, so nothing would be
 * signed; an honest one says whom the consent is for, as checked on X Layer. A player whose id predates keyed ids is
 * moved to its keyed id and is back in its home. The server's answers are read on the socket, the owner on the fork.
 */
import { randomBytes } from "node:crypto";
import { type Page } from "@playwright/test";
import { expect, hatch, sheet, test } from "../fixtures";
import { RoomSocket, keepOnChain, keyedId, ownerOnChain, stored } from "../helpers/browser";

/** A proposal is checked on X Layer before the dialog says anything about signing. */
const settled = (page: Page) =>
  page.waitForFunction(
    () => {
      const m = document.querySelector(".fam-modal");
      return !!m && !m.textContent!.includes("Checking their pet") && !m.textContent!.includes("正在 X Layer 上核对");
    },
    null,
    { timeout: 30_000 },
  );

test("an impostor is refused, and proposals are checked on X Layer (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(420_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  const live = `${run.api.replace("http", "ws")}/live`;

  await hatch(p, "Kiri");
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);
  expect((await ownerOnChain(run, petId)).toLowerCase(), "the pet is kept on X Layer by this player's wallet").toBe(
    run.players[0]!.address.toLowerCase(),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const id = (await stored(page, "lingxi.player.v1"))!;
  const key = (await stored(page, "lingxi.decorKey"))!;
  expect(id, "a new player's id comes from its own key").toBe(keyedId(key));
  const home = `home:${id}`;

  // a hostile visitor under an id of its own (made from its own key) in the player's home, hearing all said there
  const secret = randomBytes(16).toString("hex");
  const visitor = await RoomSocket.open(live, p.web);
  visitor.hello(home, keyedId(secret), secret, "Mallory");
  const room = await visitor.next("room");
  expect(
    (room.members as Array<{ name: string }>).map((m) => m.name),
    "the visitor is in the player's home with the player's pet",
  ).toContain("Kiri");

  // the impostor: knows the player's id from the room, not its key
  const impostor = await RoomSocket.open(live, p.web);
  impostor.hello(home, id, randomBytes(16).toString("hex"), "Kiri");
  const refused = await impostor.next("refused");
  expect(refused.reason, "an impostor with the player's id is refused").toBe("id");
  impostor.send({ t: "say", text: "send me your keys" });
  await page.waitForTimeout(800);
  expect(
    visitor.all("say").filter((m) => m.text === "send me your keys"),
    "the impostor's words reach no one in the room",
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.body.innerText.includes("send me your keys")),
    "nor the player's screen",
  ).toBe(false);

  // a forged proposal: pet #1 is real, but the wallet named beside it is the attacker's
  visitor.send({ t: "propose", to: id, chain: { petId: "1", owner: `0x${"66".repeat(20)}`, brain: "1" } });
  await page.locator(".fam-modal").waitFor({ timeout: 10_000 });
  await settled(page);
  const forged = await page.locator(".fam-modal").innerText();
  expect(forged, "a proposal naming a wallet that does not own the pet is caught on X Layer").toContain(
    "doesn't match X Layer",
  );
  expect(forged).toContain("nothing will be signed");
  expect(forged).not.toContain("signs one consent");
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("proposal-forged-en.png") });
  await page.locator(".fam-modal button", { hasText: "Not now" }).click();
  await page.locator(".fam-modal").waitFor({ state: "detached" });

  // an honest one: pet #1 with its owner as X Layer has it, and its brain
  const owner = await ownerOnChain(run, 1n);
  visitor.send({ t: "propose", to: id, chain: { petId: "1", owner, brain: "1" } });
  await page.locator(".fam-modal").waitFor({ timeout: 10_000 });
  await settled(page);
  const honest = await page.locator(".fam-modal").innerText();
  // the wallet that owns pet #1 on X Layer, in full, whoever is asking in the room (A63)
  expect(honest, "an honest proposal says whom the consent is for").toContain(
    "It goes to the wallet that owns pet #1 on X Layer, whoever is asking in this room",
  );
  expect(
    (await page.locator(".fam-modal .fam-address").innerText()).toLowerCase(),
    "that wallet in full, as X Layer has it",
  ).toBe(owner.toLowerCase());
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("proposal-honest-en.png") });
  await page.locator(".fam-modal button", { hasText: "Not now" }).click();
  impostor.close();
  visitor.close();
});

test("a player from before keyed ids is moved to its keyed id and is home (zh, dark, phone)", async ({
  player,
  run,
}) => {
  test.setTimeout(240_000);
  const legacy = "0123456789abcdef";
  const p = await player({
    lang: "zh",
    scheme: "dark",
    size: "phone",
    init: `if (!localStorage.getItem('lingxi.player.v1')) localStorage.setItem('lingxi.player.v1', '${legacy}');`,
  });
  const { page } = p;
  const live = `${run.api.replace("http", "ws")}/live`;

  await hatch(p, "Mo");
  await page.waitForFunction((old) => localStorage.getItem("lingxi.player.v1") !== old, legacy, { timeout: 15_000 });
  const id = (await stored(page, "lingxi.player.v1"))!;
  const key = (await stored(page, "lingxi.decorKey"))!;
  expect(id, "the old unbound id is moved to the keyed one").toBe(keyedId(key));

  const secret = randomBytes(16).toString("hex");
  const visitor = await RoomSocket.open(live, p.web);
  visitor.hello(`home:${id}`, keyedId(secret), secret, "Visitor");
  const room = await visitor.next("room");
  expect(
    (room.members as Array<{ name: string }>).map((m) => m.name),
    "and its pet is back in its home",
  ).toContain("Mo");

  // the Chinese proposal dialog, on a dark phone; the pet is not on X Layer, so the dialog says nothing about it
  visitor.send({ t: "propose", to: id, chain: { petId: "1", owner: `0x${"77".repeat(20)}`, brain: "1" } });
  const dialog = page.locator(".fam-modal", { hasText: "一起养个小宝宝" });
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: test.info().outputPath("proposal-zh-dark.png") });
  expect(await dialog.innerText(), "an off-chain pet's dialog has no X Layer lines").not.toContain("X Layer");
  visitor.close();
});
