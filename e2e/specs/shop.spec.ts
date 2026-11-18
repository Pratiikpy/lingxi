/**
 * The shops on the fork, every purchase settled on chain in BEM. A player keeps a pet on X Layer, then buys through
 * the game's own buttons, signing with its test wallet: a Star lamp and all three limited Tape-out outfits from the
 * item shop, room space, saved looks and name colours from Extras. Each purchase is read back from the chain (one
 * copy held, the whole price burned to the dead address, the extras contract's own total), and each one is then used
 * as a player would: twelve pieces fill the free room and a thirteenth is refused until room space is bought; a
 * fourth saved look is refused until a looks pack is bought; a look is worn, renamed and deleted.
 *
 * With the wallet linked to the home, a friend visiting on another device sees the on-chain Star lamp and the name
 * colour, live, and loses both while the wallet is unlinked. Last, the player's other pages in Chinese, dark, on a
 * desktop: the live numbers carry the extras contract's burn, and the proof page and the tree of life show the pet's
 * name in its colour. And a fresh device with the same wallet, once connected through the fashion market, shows the
 * pieces the wallet holds and places the Star lamp in its own room.
 *
 * Not covered here: claiming a community goal's keepsake. That needs a voucher signed by the item shop's voucher
 * signer, whose key the suite's server does not hold.
 */
import type { Address } from "viem";
import { type Opened, type PlayerOptions, dismiss, expect, hatch, sheet, test } from "../fixtures";
import { DEAD, type Fork, forkOf, keepOnChain, reach, statusNote } from "../helpers/chain";

/** 0.05 BEM (8 decimals): a decoration, a room pack, a looks pack, a name colour */
const PRICE = 5_000_000n;
/** 0.1 BEM: a limited outfit */
const LIMITED = 10_000_000n;
const LIMITED_SET = [
  { name: "NAND crown", item: "nand-crown" },
  { name: "Probe visor", item: "probe-visor" },
  { name: "Wafer wand", item: "wafer-wand" },
] as const;
/** name colours as the browser computes them (NAME_COLOURS in @lingxi/world): Sky on a light page, Violet on a dark one */
const SKY_ON_LIGHT = "rgb(31, 95, 170)";
const VIOLET_ON_DARK = "rgb(201, 168, 255)";
/** the room's grid of free spots, as fractions of the stage */
const SPOTS = { x: [0.14, 0.32, 0.5, 0.68, 0.86], y: [0.5, 0.66, 0.82] };

interface World {
  coins: number;
  decor: { placed: Array<{ id: string }> };
  wardrobe: { worn: Record<string, Record<string, string | undefined>> };
}
const worldOf = (p: Opened) => p.page.evaluate(() => JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as World);
const placedOf = async (p: Opened) => (await worldOf(p)).decor?.placed.length ?? 0;

/**
 * Network failures a player would never see in the console are still failures here: any answer of 400 or more, and
 * any request that fails (except one the page itself cancels on purpose, which Chromium reports as ERR_ABORTED).
 */
function watchNetwork(p: Opened): string[] {
  const bad: string[] = [];
  const page = p.page;
  page.on("response", (r) => r.status() >= 400 && !r.url().includes("favicon") && bad.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`));
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (!why.includes("ERR_ABORTED") && !r.url().includes("favicon")) bad.push(`failed ${r.url().slice(0, 100)} ${why}`);
  });
  return bad;
}

/** Taps a free spot of the room, by its number in the grid. */
async function placeAt(p: Opened, i: number) {
  const box = (await p.page.locator(".stage canvas").first().boundingBox())!;
  await p.page.mouse.click(box.x + box.width * SPOTS.x[i % 5]!, box.y + box.height * SPOTS.y[Math.floor(i / 5) % 3]!);
}

async function openDecorate(p: Opened) {
  await p.page.keyboard.press("Escape");
  await p.page.waitForTimeout(600);
  await p.page.locator(".room-pill button", { hasText: "Decorate" }).click();
  await p.page.locator(".decor-bar").waitFor();
}

/** Buys one copy of a piece from the item shop with the game's button, and waits until the shop shows it held. */
async function buyPiece(p: Opened, name: string) {
  const card = await reach(p.page, `.itemshop-card:has-text('${name}')`);
  await card.locator(".btn.primary").click();
  await expect(p.page.locator(".itemshop-card", { hasText: name }), `${name} is shown in the wallet`).toContainText("In your wallet", { timeout: 180_000 });
}

/** Picks a colour for the pet's name in Extras and confirms it; returns the panel's message. */
async function colourName(p: Opened, colour: string) {
  const extras = await reach(p.page, ".extras");
  await extras.locator(".extras-swatch", { hasText: colour }).click();
  await extras.locator(".btn.primary:has-text('Colour it'), .btn.primary:has-text('Back to plain')").first().click();
  return statusNote(p.page, ".extras", colour === "Plain" ? "plain again" : `is ${colour} now`);
}

/**
 * A friend on another device sitting in the player's home, reading what the server sends: the home's pieces and the
 * player pet's name colour, folded from every frame in order, as the friend's game folds them.
 */
class Visitor {
  frames: Array<Record<string, unknown>> = [];
  constructor(
    readonly p: Opened,
    readonly home: string,
  ) {
    p.page.on("websocket", (ws) =>
      ws.on("framereceived", (f) => {
        if (typeof f.payload === "string" && f.payload.startsWith("{")) this.frames.push(JSON.parse(f.payload) as Record<string, unknown>);
      }),
    );
  }

  pieces(): string[] | null {
    const decor = this.frames.filter((f) => f.t === "decor" && f.owner === this.home);
    return decor.length ? (decor.at(-1)!.placed as Array<{ id: string }>).map((x) => x.id) : null;
  }

  /** The player pet's colour as the friend's game would show it; null while it is not in the room. */
  colour(): number | null {
    let c: number | null = null;
    for (const f of this.frames) {
      if (f.t === "room") {
        const m = (f.members as Array<{ id: string; colour?: number }>).find((x) => x.id === this.home);
        c = m ? (m.colour ?? 0) : null;
      } else if (f.t === "joined" && (f.member as { id: string }).id === this.home) c = (f.member as { colour?: number }).colour ?? 0;
      else if (f.t === "colour" && f.id === this.home && c !== null) c = (f.colour as number | undefined) ?? 0;
      else if (f.t === "left" && f.id === this.home) c = null;
    }
    return c;
  }

  /** Waits until what the friend has been sent satisfies `ok`. */
  until(ok: (v: Visitor) => boolean, message: string) {
    return expect.poll(() => ok(this), { message, timeout: 20_000 }).toBe(true);
  }
}

test("the shops on the fork, settled on chain, and what a visiting friend sees", async ({ player, run }) => {
  test.setTimeout(15 * 60_000);
  const fork: Fork = await forkOf(run);
  const me = run.players[0]!.address as Address;
  const spent = async () => ({ dead: await fork.bemOf(DEAD), mine: await fork.bemOf(me), burned: await fork.extrasBurned() });
  /** asserts what one purchase cost: `cost` gone from the wallet, all of it at the dead address */
  const paid = async (before: Awaited<ReturnType<typeof spent>>, cost: bigint, what: string) => {
    const now = await spent();
    expect([now.dead - before.dead, before.mine - now.mine], `${what}: ${cost} burned, ${cost} from the wallet`).toEqual([cost, cost]);
    return now;
  };
  expect(await fork.packsOf(me), "the player's wallet starts with no extras").toEqual({ room: 0, looks: 0 });

  const buyer = await player({ lang: "en", scheme: "light", size: "phone" });
  const buyerNet = watchNetwork(buyer);
  const { page } = buyer;
  let petId = "";
  let home = "";

  await test.step("keep the pet on X Layer (en, light, phone)", async () => {
    await hatch(buyer, "Pip");
    // coins are the free in-game money: enough to buy the twelve coin pieces for the room
    await page.evaluate(() => {
      const w = JSON.parse(localStorage.getItem("lingxi.world.v1") ?? "{}") as { coins?: number };
      w.coins = 1000;
      localStorage.setItem("lingxi.world.v1", JSON.stringify(w));
    });
    await page.reload();
    await page.locator(".stage").waitFor();
    await page.waitForTimeout(1_200);
    await dismiss(page);
    await sheet(page, "me");
    petId = (await keepOnChain(page)).petId;
    expect(await fork.ownerOf(petId), `pet #${petId} kept on X Layer by the player`).toBe(me);
  });

  await test.step("the item shop: a Star lamp and the three limited outfits", async () => {
    const lamp0 = await fork.heldOf(me, "star-lamp");
    const before = await spent();
    await buyPiece(buyer, "Star lamp");
    expect(await fork.heldOf(me, "star-lamp"), "Star lamp bought: one copy held").toBe(lamp0 + 1n);
    await paid(before, PRICE, "Star lamp");
    for (const { name, item } of LIMITED_SET) {
      const held0 = await fork.heldOf(me, item);
      const b = await spent();
      const card = page.locator(".itemshop-card", { hasText: name });
      const left0 = Number((await (await reach(page, `.itemshop-card:has-text('${name}')`)).innerText()).match(/(\d+) of 300 left/)?.[1]);
      expect(left0, `${name}: copies left are shown`).toBeGreaterThan(0);
      await buyPiece(buyer, name);
      expect(await fork.heldOf(me, item), `${name} bought: one copy held`).toBe(held0 + 1n);
      await paid(b, LIMITED, name);
      await expect(card, `${name}: one copy fewer left`).toContainText(`${left0 - 1} of 300 left`);
    }
    await page.locator(".itemshop").screenshot({ path: test.info().outputPath("shop-limited-en-light-phone.png") });
  });

  await test.step("the free room holds twelve pieces; a thirteenth is refused", async () => {
    await openDecorate(buyer);
    const pieces = page.locator(".decor-bar .decor-piece");
    const n = await pieces.count();
    for (let i = 0; i < n && (await placedOf(buyer)) < 12; i++) {
      const piece = pieces.nth(i);
      if ((await piece.locator("span").innerText()) === "Star lamp") continue;
      const placed = await placedOf(buyer);
      await piece.click();
      await placeAt(buyer, placed);
      await expect.poll(() => placedOf(buyer), { message: `piece ${i + 1} placed` }).toBe(placed + 1);
    }
    const w = await worldOf(buyer);
    expect(w.decor.placed.length, `twelve pieces placed in the free room (coins left ${w.coins})`).toBe(12);
    await page.locator(".decor-bar .decor-piece", { hasText: "Star lamp" }).click();
    await placeAt(buyer, 12);
    await expect(page.locator(".world-toast"), "the room says it is full").toContainText("The room is full");
    const after = await worldOf(buyer);
    expect(after.decor.placed.length, "a thirteenth piece is refused without room space").toBe(12);
    expect(after.decor.placed.some((x) => x.id === "star-lamp"), "the Star lamp is not placed").toBe(false);
    await expect(page.locator(".decor-bar .decor-hint").nth(1), "the bar reads 12 of 12").toContainText("12 of 12");
    await page.screenshot({ path: test.info().outputPath("room-full-en-light-phone.png") });
    await page.locator(".decor-bar .btn.primary", { hasText: "Done" }).click();
  });

  await test.step("room space: four more pieces, 0.05 BEM burned", async () => {
    await sheet(page, "me");
    const extras = await reach(page, ".extras");
    await extras.screenshot({ path: test.info().outputPath("extras-before-en-light-phone.png") });
    const before = await spent();
    await extras.locator(".btn.primary", { hasText: "+4 pieces" }).click();
    await statusNote(page, ".extras", "now holds 16 pieces");
    expect((await fork.packsOf(me)).room, "room pack bought: one on chain").toBe(1);
    const now = await paid(before, PRICE, "room pack");
    expect(now.burned - before.burned, "the extras contract counts the burn").toBe(PRICE);

    await openDecorate(buyer);
    await page.locator(".decor-bar .decor-piece", { hasText: "Star lamp" }).click();
    await placeAt(buyer, 13);
    await expect.poll(async () => (await worldOf(buyer)).decor.placed.some((x) => x.id === "star-lamp"), { message: "the Star lamp is placed as the thirteenth piece" }).toBe(true);
    expect(await placedOf(buyer)).toBe(13);
    await expect(page.locator(".decor-bar .decor-hint").nth(1), "the bar reads 13 of 16").toContainText("13 of 16");
    await page.screenshot({ path: test.info().outputPath("room-13-en-light-phone.png") });
    await page.locator(".decor-bar .btn.primary", { hasText: "Done" }).click();
  });

  await test.step("saved looks: three free, a pack for three more, worn, renamed, deleted", async () => {
    await sheet(page, "me");
    await reach(page, ".wd-looks");
    const looks = page.locator(".wd-looks").first();
    const chip = (slot: string, piece: string) => page.locator(`.wd-slot[aria-label='${slot}'] .wd-chip`, { hasText: piece }).first().click();
    const saveLook = async (name: string, count: string) => {
      const form = looks.locator("form.wd-look-edit");
      await form.locator("input").fill(name);
      await form.locator("button[type=submit]").click();
      await expect(looks.locator(".wd-slot-name").first()).toContainText(count);
    };
    await chip("Head", "NAND crown");
    await saveLook("Crown", "1 of 3");
    await chip("Face", "Probe visor");
    await saveLook("Crown and visor", "2 of 3");
    await chip("Held", "Wafer wand");
    await expect(page.locator(".wd-title").first(), "the full Tape-out set gives its title").toContainText("Tape-out engineer");
    await saveLook("Full set", "3 of 3");
    await chip("Head", "None");
    await expect(looks, "a fourth look is refused at the free limit of 3").toContainText("All 3 looks are used");
    await expect(looks.locator("form.wd-look-edit"), "there is no form to save a fourth").toHaveCount(0);
    await looks.screenshot({ path: test.info().outputPath("looks-full-en-light-phone.png") });

    const extras = await reach(page, ".extras");
    const before = await spent();
    await extras.locator(".btn.primary", { hasText: "+3 looks" }).click();
    await statusNote(page, ".extras", "keep 6 looks");
    expect((await fork.packsOf(me)).looks, "looks pack bought: one on chain").toBe(1);
    await paid(before, PRICE, "looks pack");

    await reach(page, ".wd-looks");
    await saveLook("Lab day", "4 of 6");
    await looks.locator(".wd-look", { hasText: "Crown" }).first().locator(".btn.primary", { hasText: "Wear" }).click();
    await expect
      .poll(async () => Object.values((await worldOf(buyer)).wardrobe.worn)[0], { message: "wearing a saved look puts the whole outfit on" })
      .toEqual(expect.objectContaining({ head: "nand-crown" }));
    const worn = Object.values((await worldOf(buyer)).wardrobe.worn)[0]!;
    expect([worn.face ?? null, worn.held ?? null], "and nothing else").toEqual([null, null]);
    await looks.locator(".wd-look", { hasText: "Lab day" }).getByRole("button", { name: "Rename Lab day" }).click();
    await looks.locator("form.wd-look-edit input").first().fill("Visor and wand");
    await looks.locator("form.wd-look-edit button[type=submit]").first().click();
    await expect(looks, "a look can be renamed").toContainText("Visor and wand");
    await looks.getByRole("button", { name: "Delete Visor and wand" }).click();
    await expect(looks.locator(".wd-slot-name").first(), "a look can be deleted").toContainText("3 of 6");
    await looks.screenshot({ path: test.info().outputPath("looks-6-en-light-phone.png") });
  });

  await test.step("name colours: Leaf (paid), plain (free), Sky (paid)", async () => {
    for (const [name, id, cost] of [
      ["Leaf", 3, PRICE],
      ["Plain", 0, 0n],
      ["Sky", 4, PRICE],
    ] as const) {
      const before = await spent();
      await colourName(buyer, name);
      expect(await fork.colourOf(petId), `name colour ${name}: ${id} on chain`).toBe(id);
      await paid(before, cost, `name colour ${name}`);
    }
    await page.locator(".extras").screenshot({ path: test.info().outputPath("extras-colour-en-light-phone.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    const top = page.locator(".pet-named").first();
    await expect(top, "the top bar shows the name").toHaveText("Pip");
    await expect(top, "in Sky").toHaveCSS("color", SKY_ON_LIGHT);
    await page.screenshot({ path: test.info().outputPath("home-sky-en-light-phone.png") });
  });

  await test.step("link the wallet so visitors see what it holds", async () => {
    await sheet(page, "me");
    const extras = await reach(page, ".extras");
    await extras.getByRole("button", { name: "Link a wallet" }).click();
    const msg = await statusNote(page, ".extras", `Linked ${me.slice(0, 6)}`);
    expect(msg, "wallet linked by signature").toContain("Visitors now see what it holds");
    expect([...buyer.errors, ...buyerNet], "the player's pages are clean so far").toEqual([]);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    home = (await page.evaluate(() => localStorage.getItem("lingxi.player.v1")))!;
    expect(home, "the player's home id").toBeTruthy();
  });

  await test.step("a friend visits on another device (zh, dark, desktop) and sees it live", async () => {
    const friend = await player({ lang: "zh", scheme: "dark", size: "desktop", wallet: 1 });
    const friendNet = watchNetwork(friend);
    const v = new Visitor(friend, home);
    await hatch(friend, "小米");
    await friend.page.goto(`${friend.web}/play.html?visit=${home}`);
    await friend.page.locator(".stage").waitFor();
    await v.until((x) => x.pieces() !== null && x.colour() !== null, "the friend is in the home with the player");
    await dismiss(friend.page);
    expect(v.pieces()!.length, "visitor sees 13 pieces").toBe(13);
    expect(v.pieces(), "including the on-chain Star lamp").toContain("star-lamp");
    expect(v.colour(), "visitor sees Pip's name in Sky").toBe(4);
    await friend.page.screenshot({ path: test.info().outputPath("visit-linked-zh-dark-desktop.png") });

    // the player recolours while the friend is there: the friend sees it change without reloading
    await sheet(page, "me");
    const before = await spent();
    await colourName(buyer, "Violet");
    expect(await fork.colourOf(petId), "name colour Violet: 5 on chain").toBe(5);
    await paid(before, PRICE, "name colour Violet");
    await v.until((x) => x.colour() === 5, "the visiting friend sees Violet live");

    // unlinked: the friend loses what only the chain vouched for, live
    const extras = await reach(page, ".extras");
    await extras.locator(".extras-wallets button", { hasText: "Unlink" }).click();
    await statusNote(page, ".extras", "Unlinked");
    await v.until((x) => x.colour() === 0 && x.pieces() !== null && !x.pieces()!.includes("star-lamp"), "unlinked: the friend sees no Star lamp and a plain name");
    expect(v.pieces()!.length, "unlinked: the friend sees the twelve game pieces").toBe(12);
    await friend.page.screenshot({ path: test.info().outputPath("visit-unlinked-zh-dark-desktop.png") });

    // linked again: both come back
    await (await reach(page, ".extras")).getByRole("button", { name: "Link a wallet" }).click();
    await statusNote(page, ".extras", `Linked ${me.slice(0, 6)}`);
    await v.until((x) => x.colour() === 5 && (x.pieces() ?? []).includes("star-lamp"), "linked again: the friend sees the Star lamp and Violet again");
    await friend.page.screenshot({ path: test.info().outputPath("visit-relinked-zh-dark-desktop.png") });
    expect([...friend.errors, ...friendNet], "the friend's pages are clean").toEqual([]);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    expect([...buyer.errors, ...buyerNet], "the player's pages are clean at the end").toEqual([]);
  });

  await test.step("the player's other pages (zh, dark, desktop)", async () => {
    // the same player on a desktop: its save is carried over, as a browser that already played would hold it
    const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k !== "lingxi.lang"));
    const restore: PlayerOptions["init"] = `if (!localStorage.getItem('lingxi.chain.v2')) for (const [k, v] of ${JSON.stringify(saved)}) localStorage.setItem(k, v);`;
    const desk = await player({ lang: "zh", scheme: "dark", size: "desktop", init: restore });
    const deskNet = watchNetwork(desk);
    const dp = desk.page;

    await dp.goto(`${desk.web}/numbers.html`);
    const row = dp.locator(".nb-row", { hasText: "小额外销毁" });
    await expect(row.locator(".nb-value"), "the live numbers show what extras burned").toContainText("BEM", { timeout: 90_000 });
    const burned = await fork.extrasBurned();
    const shown = Number((await row.locator(".nb-value").innerText()).replace(/[^0-9.]/g, ""));
    expect(shown, `live numbers: burned by extras equals the chain's own total (${Number(burned) / 1e8} BEM)`).toBeCloseTo(Number(burned) / 1e8, 9);
    await dp.screenshot({ path: test.info().outputPath("numbers-zh-dark-desktop.png"), fullPage: true });

    await dp.goto(`${desk.web}/verify.html#${petId}`);
    await dp.locator(".v-card").first().waitFor({ timeout: 90_000 });
    await expect(dp.locator("#contracts [role=status]"), "the proof page has asked every contract").not.toContainText("正在询问", { timeout: 90_000 });
    await dp.locator(".pet-named").first().waitFor({ timeout: 60_000 });
    const named = dp.locator(".pet-named").first();
    await expect(named, "proof page shows the pet's name").toContainText(`#${petId}`);
    await expect(named, "in Violet").toHaveCSS("color", VIOLET_ON_DARK);
    await expect(dp.locator("#contracts tr", { hasText: "Extras" }), "proof page lists Extras among the contracts").toHaveCount(1);
    await dp.screenshot({ path: test.info().outputPath("verify-zh-dark-desktop.png") });

    await dp.goto(`${desk.web}/tree.html`);
    const onTree = dp.locator(".pet-named", { hasText: `#${petId}` }).first();
    await onTree.waitFor({ timeout: 90_000 });
    await expect(onTree, "tree of life shows the pet in Violet").toHaveCSS("color", VIOLET_ON_DARK);
    await dp.screenshot({ path: test.info().outputPath("tree-zh-dark-desktop.png") });

    await dp.goto(`${desk.web}/play.html`);
    await dp.locator(".stage").waitFor();
    await dp.waitForTimeout(1_200);
    await dismiss(dp);
    await sheet(dp, "me");
    await (await reach(dp, ".extras")).screenshot({ path: test.info().outputPath("extras-zh-dark-desktop.png") });
    await (await reach(dp, ".itemshop")).screenshot({ path: test.info().outputPath("shop-zh-dark-desktop.png") });
    await (await reach(dp, ".wd-looks")).screenshot({ path: test.info().outputPath("looks-zh-dark-desktop.png") });
    await dp.keyboard.press("Escape");
    await dp.waitForTimeout(800);
    await dp.screenshot({ path: test.info().outputPath("home-zh-dark-desktop.png") });
    expect(deskNet, "the desktop pages' requests are clean").toEqual([]);
  });

  await test.step("a fresh device with the same wallet sees what it holds once connected (zh, dark, desktop)", async () => {
    const fresh = await player({ lang: "zh", scheme: "dark", size: "desktop" });
    const freshNet = watchNetwork(fresh);
    const fp = fresh.page;
    await hatch(fresh, "Bean");
    await sheet(fp, "me");
    const shop = await reach(fp, ".itemshop");
    await expect(shop.locator(".itemshop-card").first(), "the shelf is read from the chain").not.toContainText("读取中", { timeout: 30_000 });
    await expect(shop.locator(".fashion-have"), "before a wallet is connected, nothing is shown as held").toHaveCount(0);
    // connected through the fashion market's button: the shop reads the wallet's pieces without buying anything
    await (await reach(fp, ".fashion")).getByRole("button", { name: "连接钱包" }).click();
    await expect(fp.locator(".itemshop .fashion-have"), "the Star lamp and the three outfits are shown as held").toHaveCount(4, { timeout: 60_000 });
    await (await reach(fp, ".itemshop")).screenshot({ path: test.info().outputPath("shop-connected-zh-dark-desktop.png") });
    await fp.keyboard.press("Escape");
    await fp.waitForTimeout(600);
    await fp.locator(".room-pill button", { hasText: "布置" }).click();
    await fp.locator(".decor-bar").waitFor();
    await fp.locator(".decor-bar .decor-piece", { hasText: "星星灯" }).click();
    await placeAt(fresh, 0);
    await expect.poll(async () => (await worldOf(fresh)).decor.placed.some((x) => x.id === "star-lamp"), { message: "the Star lamp the wallet holds is placed in this device's room" }).toBe(true);
    await fp.screenshot({ path: test.info().outputPath("home-connected-zh-dark-desktop.png") });
    expect(freshNet, "the fresh device's requests are clean").toEqual([]);
  });
});
