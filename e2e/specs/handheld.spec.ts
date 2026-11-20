/**
 * A pet taken out on the handheld and brought home (plan 4.14), as a player does it. The handheld is the firmware's
 * own app in WebAssembly, in its own tab; the game lets a pet back in only after replaying the whole trip itself.
 *
 * A pet kept on X Layer is packed with snacks, cared for with the handheld's keys, lives three hours with the handheld
 * put down and is sent home; a damaged packet and a pet called back without its days are refused or undone cleanly. A
 * pet never kept travels on the game's own circuit. A Cardputer over USB (Web Serial answered by the firmware's own
 * link, compiled to WebAssembly) takes a pet, gives it back, lets go of one called back, and is never emptied of
 * another game's pet. A device clock hours off, and a handheld a moment ahead of the game, still bring the pet home
 * (A6). The handheld's tab stays the handheld and follows the game, is told when the game refused the pet, works
 * without Web Locks, and becomes the game when no game tab is open (A7). The empty handheld fits every screen.
 * Every step is read in the save; failed requests count as errors.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, type Page } from "@playwright/test";
import { type Look, type Opened, dismiss, expect, hatch, sheet, test } from "../fixtures";
import { ROOT } from "../harness/run";
import { NO_LOCKS, bagOf, giveFood, keepOnChain, ownerOnChain, petOf, reach, stored, storedJson, tallyOf, watchRequests } from "../helpers/browser";

const TARO = 11110;
const HONEY = 11140;
const TRIP = "lingxi.handheld.trip.v1";
const RET = "lingxi.handheld.return.v1";
const DEVICE = "lingxi.handheld.device.v1";
const INBOX = "lingxi.handheld.inbox.v1";
const OWED = "lingxi.handheld.owed.v1";
const HOUR = 3_600_000;

interface Trip {
  via: "browser" | "cardputer";
  packet: string;
  brain: { source: "chain" | "game" };
}

/** The handheld's boot screen, before its keys answer. */
const BOOT_MS = 1_900;
const bringHome = (hh: Page, zh = false) => hh.locator("button.btn.primary", { hasText: zh ? "带回家" : "Bring home" });
const homeFromHandheld = (page: Page) => page.locator(".fam-modal", { hasText: /Home from the handheld|从掌机回来了/ });
const staysOut = (page: Page) => page.locator(".fam-modal", { hasText: /It stays out|它还在外面/ });
const elsewhere = (page: Page) => page.getByText(/Lingxi is open in another tab|灵犀在另一个标签页里开着/);
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });

/** A key on the handheld, pressed as a player presses it, with a moment for the screen to answer. */
async function key(hh: Page, k: string, wait = 250): Promise<void> {
  await hh.keyboard.press(k);
  await hh.waitForTimeout(wait);
}

/** Clicks "Take it along" (or another button that opens the handheld) and returns the handheld's tab. */
async function opensHandheld(ctx: BrowserContext, click: () => Promise<void>): Promise<Page> {
  const [hh] = await Promise.all([ctx.waitForEvent("page", { timeout: 60_000 }), click()]);
  await hh.waitForURL("**/handheld.html", { timeout: 60_000 });
  return hh;
}

/** Packs the first snack in the bag and takes the pet along; returns the handheld's tab, booted with the pet aboard. */
async function outWithOneSnack(p: Opened): Promise<Page> {
  const { page, ctx } = p;
  await hatch(p, "Pip");
  await giveFood(p, { [TARO]: 2 });
  await sheet(page, "me");
  await (await reach(page, ".handheld-panel")).scrollIntoViewIfNeeded();
  await page.locator(".handheld-snacks li").first().locator("button[aria-label]").last().click();
  const hh = await opensHandheld(ctx, () => page.locator(".handheld-panel .btn.primary").click());
  await bringHome(hh, p.look.lang === "zh").waitFor({ timeout: 30_000 });
  await hh.waitForTimeout(BOOT_MS);
  return hh;
}

/* ── out and home ─────────────────────────────────────────────────────── */

// the game's time server answers with the browser's own clock, which this test moves on three hours: real time moves
// the server's clock too, and a server whose time stood still would make any trip look early (A6)
const SERVER_FOLLOWS_THE_CLOCK = `{ const f = window.fetch.bind(window);
  window.fetch = (i, o) => String(i instanceof Request ? i.url : i).endsWith('/api/time')
    ? Promise.resolve(new Response(JSON.stringify({ now: Date.now() }), { headers: { 'content-type': 'application/json' } }))
    : f(i, o); }`;

test("a pet kept on X Layer goes out on the handheld, lives three hours there and comes home (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone", init: SERVER_FOLLOWS_THE_CLOCK });
  watchRequests(p);
  const { ctx } = p;
  let pg = p.page;
  await hatch(p, "Pip");
  // the clock that will move three hours on is installed just before the game's last load: Playwright's clock carries
  // performance.now() across a page's loads while the browser's animation timeline starts again with each, and Motion
  // starts the game's native animations by performance.now(), so on a page loaded long after the clock was installed
  // a closing sheet's backdrop would linger that long over the room
  await ctx.clock.install();
  await giveFood(p, { [TARO]: 3, [HONEY]: 2 });

  // kept on X Layer first, so the brain that travels is the circuit read from the chain
  await sheet(pg, "me");
  const petId = await keepOnChain(p, run, true);
  expect((await ownerOnChain(run, petId)).toLowerCase(), `pet #${petId} is kept on X Layer by this player's wallet`).toBe(run.players[0]!.address.toLowerCase());

  // called back without its days (the handheld lost): home as it left, every snack returned, and the handheld lets go
  await (await reach(pg, ".handheld-panel")).scrollIntoViewIfNeeded();
  const bagBeforeCall = await bagOf(pg);
  await pg.locator(".handheld-snacks li", { hasText: "Honey Mochi" }).locator("button[aria-label='one more']").click();
  const lost = await opensHandheld(ctx, () => pg.locator(".handheld-panel .btn.primary").click());
  await pg.locator(".away-card", { hasText: "Out on the handheld" }).waitFor();
  await bringHome(lost).waitFor({ timeout: 30_000 });
  const left = (await petOf(pg))!;
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(600);
  await pg.locator(".handheld-textbtn").click();
  await pg.locator(".away-card button", { hasText: "Call it back" }).click();
  await pg.locator(".away-card").waitFor({ state: "detached", timeout: 10_000 });
  const called = (await petOf(pg))!;
  expect(called.away ?? null, "called back: the pet is home").toBeNull();
  expect(await bagOf(pg), "and its snacks are back in the bag").toEqual(bagBeforeCall);
  expect(called.beat, "it comes back as it left, then catches up").toBeGreaterThanOrEqual(left.beat);
  await lost.getByText("No pet aboard").waitFor({ timeout: 10_000 });
  await shot(lost, "00-handheld-after-callback");
  await lost.close();
  await sheet(pg, "me");

  // pack two Taro Mochi and one Honey Mochi
  const panel = await reach(pg, ".handheld-panel");
  await panel.screenshot({ path: test.info().outputPath("01-panel-en-light.png") });
  const taro = pg.locator(".handheld-snacks li", { hasText: "Taro Mochi" });
  const honey = pg.locator(".handheld-snacks li", { hasText: "Honey Mochi" });
  await taro.locator("button[aria-label='one more']").click();
  await taro.locator("button[aria-label='one more']").click();
  await honey.locator("button[aria-label='one more']").click();
  await expect(taro.locator("output"), "the stepper shows the picks").toHaveText("2");
  await expect(honey.locator("output")).toHaveText("1");
  const bag0 = await bagOf(pg);
  const care0 = await tallyOf(pg, "CARE");
  const hh = await opensHandheld(ctx, () => pg.locator(".handheld-panel .btn.primary").click());
  const trip = await storedJson<Trip>(pg, TRIP);
  expect(trip?.brain.source, "the trip is written, its brain read from X Layer").toBe("chain");
  const bag1 = await bagOf(pg);
  expect(bag1[TARO] ?? 0, "the snacks left the bag").toBe((bag0[TARO] ?? 0) - 2);
  expect(bag1[HONEY] ?? 0).toBe((bag0[HONEY] ?? 0) - 1);
  const petA = (await petOf(pg))!;
  expect(petA.away?.code, "the pet is paused at home, away on the handheld").toBe("handheld");
  await pg.locator(".away-card", { hasText: "Out on the handheld" }).waitFor();
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(700);
  await shot(pg, "02-away-card-en");

  // on the handheld: its self-test, the pet aboard, cared for with the keys
  await hh.locator(".hh-ok").waitFor({ timeout: 30_000 });
  await expect(hh.locator(".hh-ok"), "the handheld's self-test passed").toContainText("Self-test passed");
  await bringHome(hh).waitFor({ timeout: 30_000 });
  await hh.waitForTimeout(BOOT_MS);
  await shot(hh, "03-handheld-home-en");
  await key(hh, "f"); // two kinds packed: the snack picker
  await hh.locator(".hh-screen").screenshot({ path: test.info().outputPath("04-screen-snacks.png") });
  await key(hh, "1"); // Taro Mochi
  await key(hh, "h");
  await key(hh, "t");
  await key(hh, "c");
  await hh.locator(".hh-key[aria-label^='P ']").click(); // the on-screen key, as a phone player would
  await hh.waitForTimeout(700);
  await key(hh, "Space", 1_300); // stop the bar; the play is given 0.9 s later
  await hh.locator(".hh-screen").screenshot({ path: test.info().outputPath("05-screen-after-care.png") });
  await key(hh, "b");
  await hh.locator(".hh-screen").screenshot({ path: test.info().outputPath("06-screen-brain.png") });
  await key(hh, "Escape");

  // three hours with the handheld put down, then picked up again
  await ctx.clock.fastForward("03:00:00");
  await hh.waitForTimeout(800);
  await key(hh, "h");
  const device = await storedJson<{ packet: string; log: string }>(hh, DEVICE);
  expect(device?.packet, "the handheld keeps its trip: the packet").toBeTruthy();
  expect(device?.log, "and its log").toBeTruthy();
  // a reload takes up the very same pet
  await hh.reload();
  await bringHome(hh).waitFor({ timeout: 30_000 });
  await hh.waitForTimeout(BOOT_MS);
  await hh.locator(".hh-screen").screenshot({ path: test.info().outputPath("07-screen-after-reload.png") });

  // a damaged packet is refused and nothing changes: the game is closed while the handheld sends the pet home, so
  // the packet can be read and damaged on the way
  await pg.close();
  await hh.route("**/play.html*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>held</title>" }));
  await bringHome(hh).click();
  await hh.waitForURL("**/play.html*", { timeout: 10_000 });
  const packet = (await stored(hh, RET))!;
  const damaged = Buffer.from(packet, "base64");
  damaged[40] = (damaged[40] ?? 0) ^ 1;
  await hh.evaluate(([k, v]) => localStorage.setItem(k!, v!), [RET, damaged.toString("base64")]);
  pg = await ctx.newPage();
  await pg.goto(`${p.web}/play.html#handheld-home`);
  await staysOut(pg).waitFor({ timeout: 20_000 });
  await expect(staysOut(pg), "a damaged packet is refused").toContainText("damaged");
  await shot(pg, "08-refused-damaged");
  await staysOut(pg).locator("button").click();
  const petB = (await petOf(pg))!;
  expect(petB.away?.code, "the refusal leaves the pet out").toBe("handheld");
  expect(await bagOf(pg), "and the bag as it was").toEqual(bag1);
  expect(await stored(pg, RET), "a refused packet is not checked again on every visit").toBeNull();

  // the real packet: the game replays the trip and the pet comes home; the open game picks it up as it lands
  const bagBefore = await bagOf(pg);
  await hh.evaluate(([k, v]) => localStorage.setItem(k!, v!), [RET, packet]);
  await homeFromHandheld(pg).waitFor({ timeout: 30_000 });
  const said = await homeFromHandheld(pg).innerText();
  expect(said, "the pet is home after an exact replay").toContain("arrived at exactly the pet");
  expect(said, "of its three hours out").toContain("3 hours");
  await shot(pg, "09-home");
  await homeFromHandheld(pg).locator("button").click();
  const petC = (await petOf(pg))!;
  expect(petC.away ?? null, "the pet is no longer away").toBeNull();
  const bag2 = await bagOf(pg);
  expect(bag2[TARO] ?? 0, "the uneaten snacks are back in the bag: one Taro Mochi").toBe((bagBefore[TARO] ?? 0) + 1);
  expect(bag2[HONEY] ?? 0, "and one Honey Mochi").toBe((bagBefore[HONEY] ?? 0) + 1);
  expect(await tallyOf(pg, "CARE"), "care on the handheld counts in the tally").toBeGreaterThan(care0);
  expect(petC.beat - petA.beat, "the pet lived the trip: its beat moved three hours").toBeGreaterThanOrEqual(180);
  for (const k of [TRIP, DEVICE, RET]) expect(await stored(pg, k), `the trip's memory is cleared (${k})`).toBeNull();
});

test("a pet never kept on X Layer travels on the game's own circuit (zh, dark, desktop)", async ({ player }) => {
  test.setTimeout(300_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  watchRequests(p);
  const { page, ctx } = p;
  await hatch(p, "团团");
  await giveFood(p, { [TARO]: 3 });
  await sheet(page, "me");
  const panel = await reach(page, ".handheld-panel");
  await panel.screenshot({ path: test.info().outputPath("11-panel-zh-dark.png") });
  await page.locator(".handheld-snacks li", { hasText: "芋泥麻薯" }).locator("button[aria-label='多一个']").click();
  const hh = await opensHandheld(ctx, () => page.locator(".handheld-panel .btn.primary").click());
  expect((await storedJson<Trip>(page, TRIP))?.brain.source, "an unkept pet travels on the game's own circuit").toBe("game");
  await bringHome(hh, true).waitFor({ timeout: 30_000 });
  await hh.waitForTimeout(BOOT_MS);
  await key(hh, "f", 300);
  await shot(hh, "12-handheld-zh-dark-desktop");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await shot(page, "12b-away-card-zh-dark");
  await bringHome(hh, true).click();
  await homeFromHandheld(page).waitFor({ timeout: 30_000 });
  await shot(page, "13-home-zh-dark");
  await expect(homeFromHandheld(page), "home after an exact replay on the game's circuit").toContainText("得到的正是掌机送回来的宠物");
  await homeFromHandheld(page).locator("button").click();
  expect((await petOf(page))?.away ?? null, "the pet is home in the save").toBeNull();
});

/* ── a Cardputer over USB ─────────────────────────────────────────────── */

const DEVICE_WASM = "/__e2e/cardputer.wasm";
/**
 * Web Serial answered by a Cardputer: the firmware's own link (core/link.h), compiled to WebAssembly, behind a port
 * the game opens as it would a real one. A device that already carries another game's pet is set up from storage.
 */
const CARDPUTER = `(() => {
  const dev = { x: null, ready: () => dev.x.hh_ready(), key: (k) => dev.x.hh_key(k.charCodeAt(0)) };
  window.__dev = dev;
  const boot = fetch('${DEVICE_WASM}').then((r) => r.arrayBuffer()).then((b) => WebAssembly.instantiate(b, {})).then(({ instance }) => {
    dev.x = instance.exports; dev.x.hh_init(0); dev.x.hh_link_init();
    const foreign = localStorage.getItem('e2e.foreign');
    if (foreign) {
      const line = new TextEncoder().encode('LXPUT ' + foreign + '\\n');
      new Uint8Array(dev.x.memory.buffer).set(line, dev.x.hh_link_in());
      dev.x.hh_link_feed(line.length, 0);
      dev.x.hh_link_reply_take();
    }
  });
  const t0 = performance.now();
  let reply = null;
  const port = {
    readable: null, writable: null,
    async open() {
      await boot;
      port.readable = new ReadableStream({ start(c) { reply = (b) => c.enqueue(b); } });
      port.writable = new WritableStream({ write(chunk) {
        const x = dev.x;
        new Uint8Array(x.memory.buffer).set(chunk, x.hh_link_in());
        x.hh_link_feed(chunk.length, Math.floor(performance.now() - t0));
        const n = x.hh_link_reply_take();
        if (n) reply(new Uint8Array(x.memory.buffer, x.hh_link_reply(), n).slice());
      } });
    },
    async close() { port.readable = null; port.writable = null; },
  };
  Object.defineProperty(navigator, 'serial', { value: { getPorts: async () => [port], requestPort: async () => port } });
})();`;

test("a Cardputer over USB takes the pet, gives it back, and is never emptied of another game's pet (en, light, desktop)", async ({ player }) => {
  test.setTimeout(300_000);
  const p = await player({ lang: "en", scheme: "light", size: "desktop", init: CARDPUTER });
  watchRequests(p);
  const wasm = readFileSync(join(ROOT, "packages/handheld/wasm/lingxi-handheld.wasm"));
  await p.ctx.route(`**${DEVICE_WASM}`, (r) => r.fulfill({ status: 200, contentType: "application/wasm", body: wasm }));
  const { page } = p;
  const ready = () => page.evaluate(() => (window as unknown as { __dev: { ready(): number } }).__dev.ready());
  const deviceKey = (k: string) => page.evaluate((c) => (window as unknown as { __dev: { key(k: string): void } }).__dev.key(c), k);
  const owed = () => storedJson<string[]>(page, OWED);
  const away = page.locator(".away-card", { hasText: "Out on the Cardputer" });
  const homeFromCardputer = page.locator(".away-card button", { hasText: "Bring it home from the Cardputer" });

  await hatch(p, "Kit");
  await giveFood(p, { [TARO]: 5 });
  const toCardputer = async (taro: number) => {
    await sheet(page, "me");
    await reach(page, ".handheld-panel");
    for (let i = 0; i < taro; i++) await page.locator(".handheld-snacks li", { hasText: "Taro Mochi" }).locator("button[aria-label='one more']").click();
    await page.locator(".handheld-panel button", { hasText: "On a Cardputer" }).click();
  };

  await toCardputer(2);
  await away.waitFor({ timeout: 60_000 });
  expect(await ready(), "the device took the pet").toBe(1);
  expect((await petOf(page))?.away?.code, "and the game paused it").toBe("handheld");
  expect((await storedJson<Trip>(page, TRIP))?.via, "the trip is recorded as via the Cardputer").toBe("cardputer");
  expect(await stored(page, INBOX), "with nothing in the browser handheld's inbox").toBeNull();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await shot(page, "14-cardputer-away");

  // cared for on the device's own keys, then home
  for (const k of "fhtc") await deviceKey(k);
  const bag0 = await bagOf(page);
  await homeFromCardputer.click();
  await homeFromHandheld(page).waitFor({ timeout: 30_000 });
  const said = await homeFromHandheld(page).innerText();
  expect(said, "home after an exact replay").toContain("arrived at exactly the pet");
  expect(said, "its care counted").toContain("Cared for 4 times");
  expect(await ready(), "the device let the pet go only after the game took it").toBe(0);
  expect((await bagOf(page))[TARO] ?? 0, "one uneaten Taro Mochi is back in the bag").toBe((bag0[TARO] ?? 0) + 1);
  await homeFromHandheld(page).locator("button").click();

  // called back while the Cardputer was away: the next time it is plugged in, that pet is let go first
  await toCardputer(1);
  await away.waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.locator(".handheld-textbtn").click();
  await page.locator(".away-card button", { hasText: "Call it back" }).click();
  await page.locator(".away-card").waitFor({ state: "detached", timeout: 10_000 });
  expect(await ready(), "called back while the device still carries it").toBe(1);
  expect(await owed(), "the game owes the device a release").toHaveLength(1);
  await toCardputer(1);
  await away.waitFor({ timeout: 60_000 });
  expect(await ready(), "the called-back pet was let go and the new trip taken").toBe(1);
  expect(await owed(), "nothing is owed any more").toEqual([]);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await homeFromCardputer.click();
  await homeFromHandheld(page).waitFor({ timeout: 30_000 });
  await homeFromHandheld(page).locator("button").click();

  // a Cardputer carrying someone else's pet: the game forgets this trip, as another browser would never have known it
  await toCardputer(1);
  await away.waitFor({ timeout: 60_000 });
  await page.evaluate((tripKey) => {
    const t = JSON.parse(localStorage.getItem(tripKey)!) as { packet: string };
    localStorage.setItem("e2e.foreign", [...atob(t.packet)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    localStorage.removeItem(tripKey);
    const r = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<Record<string, unknown>> };
    r.pets = r.pets.map(({ away: _away, ...rest }) => rest);
    localStorage.setItem("lingxi.pets.v2", JSON.stringify(r));
  }, TRIP);
  await page.reload();
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_000);
  await dismiss(page);
  const bagB = await bagOf(page);
  await toCardputer(1);
  const warn = page.locator(".handheld-panel .sp-warn");
  await warn.waitFor({ timeout: 30_000 });
  await expect(warn, "the game refuses to empty a device carrying another game's pet").toContainText("carrying another pet");
  expect(await bagOf(page), "and changes nothing: the bag").toEqual(bagB);
  expect((await petOf(page))?.away ?? null, "the pet").toBeNull();
  expect(await ready(), "the device still carries the other pet").toBe(1);
  await page.locator(".handheld-panel").screenshot({ path: test.info().outputPath("15-cardputer-refused.png") });
});

/* ── the empty handheld ───────────────────────────────────────────────── */

for (const size of ["phone", "desktop"] as const)
  for (const scheme of ["light", "dark"] as const)
    for (const lang of ["en", "zh"] as const)
      test(`the empty handheld fits the screen (${lang}, ${scheme}, ${size})`, async ({ player }) => {
        const p = await player({ lang, scheme, size, firstVisit: true });
        watchRequests(p);
        await p.page.goto(`${p.web}/handheld.html`);
        await p.page.locator(".hh-ok").waitFor({ timeout: 30_000 });
        await p.page.waitForTimeout(BOOT_MS);
        await p.page.screenshot({ path: test.info().outputPath(`page-${size}-${scheme}-${lang}.png`), fullPage: true });
        expect(await p.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), "no sideways scroll").toBe(false);
      });

/* ── A6: the device's clock ───────────────────────────────────────────── */

// the handheld page's server answers 25 s ahead of the real one: two pages that asked the server moments apart,
// exaggerated
const HANDHELD_AHEAD = `if (location.pathname.endsWith('handheld.html')) {
  const f = window.fetch.bind(window);
  window.fetch = (i, o) => String(i instanceof Request ? i.url : i).endsWith('/api/time')
    ? f(i, o).then((r) => r.json()).then((j) => new Response(JSON.stringify({ now: j.now + 25000 }), { headers: { 'content-type': 'application/json' } }))
    : f(i, o);
}`;

for (const c of [
  { tag: "A", what: "the device's clock runs three hours fast", look: { lang: "en", scheme: "light", size: "phone" }, skew: 3 * HOUR, ahead: false },
  { tag: "B", what: "the device's clock runs three hours slow", look: { lang: "zh", scheme: "dark", size: "desktop" }, skew: -3 * HOUR, ahead: false },
  { tag: "C", what: "the handheld runs a moment ahead of the game, into the next minute", look: { lang: "en", scheme: "light", size: "phone" }, skew: 0, ahead: true },
  { tag: "D", what: "the handheld runs a moment ahead of the game, into the next minute", look: { lang: "zh", scheme: "dark", size: "desktop" }, skew: 0, ahead: true },
] as const satisfies ReadonlyArray<{ tag: string; what: string; look: Look; skew: number; ahead: boolean }>) {
  test(`${c.tag}: the pet comes home when ${c.what} (${c.look.lang}, ${c.look.scheme}, ${c.look.size})`, async ({ player }) => {
    test.setTimeout(300_000);
    const p = await player({ ...c.look, init: c.ahead ? HANDHELD_AHEAD : "" });
    watchRequests(p);
    if (c.skew) {
      // the device's clock is wrong; it still moves at the right speed
      await p.ctx.clock.install({ time: new Date(Date.now() + c.skew) });
      await p.ctx.clock.resume();
    }
    const zh = c.look.lang === "zh";
    const hh = await outWithOneSnack(p);
    await key(hh, "h", 600); // a care on the handheld
    if (c.ahead) {
      // sent home late in a minute: the game's clock is the server's (this machine's), the handheld's runs 25 s ahead,
      // so the handheld has already started the next minute
      await hh.waitForTimeout(((47 - ((Date.now() / 1000) % 60) + 60) % 60) * 1000);
      const second = (Date.now() / 1000) % 60;
      expect(second, `sent at second ${Math.floor(second)} of the minute`).toBeGreaterThanOrEqual(45);
      expect(second).toBeLessThan(55);
    }
    await bringHome(hh, zh).click();
    // the handheld's tab stays the handheld while the game's open tab brings the pet home (A7)
    await hh.locator(".hh-sent, .hh-ok, .hh-bad").last().waitFor({ timeout: 15_000 });
    const { page } = p;
    if (c.ahead) {
      const onItsWay = page.locator(".fam-modal", { hasText: /On its way home|正在回家的路上/ });
      await onItsWay.waitFor({ timeout: 20_000 });
      await shot(page, `${c.tag}-on-its-way`);
      await expect(onItsWay, "the game says the pet is on its way").toContainText(zh ? "马上就到" : "It will be here in a moment");
    }
    await homeFromHandheld(page).or(staysOut(page)).waitFor({ timeout: 45_000 });
    await shot(page, `${c.tag}-result`);
    await shot(hh, `${c.tag}-handheld-tab-after`);
    expect(await staysOut(page).count(), "the pet is not refused").toBe(0);
    await expect(homeFromHandheld(page), "the pet comes home").toBeVisible();
    expect((await petOf(page))?.away ?? null, "the pet is home in the save").toBeNull();
  });
}

/* ── A7: the handheld's tab ───────────────────────────────────────────── */

// every line the handheld's panel shows, kept as it appears (the game can take the pet home within a second)
const SEEN = `if (location.pathname.endsWith('handheld.html')) {
  window.__seen = [];
  new MutationObserver(() => document.querySelectorAll('.hh-sent, .hh-ok, .hh-bad').forEach((e) => { if (!window.__seen.includes(e.textContent)) window.__seen.push(e.textContent); }))
    .observe(document, { subtree: true, childList: true, characterData: true });
}`;
const seenSentHome = (hh: Page) => hh.waitForFunction(() => (window as unknown as { __seen: string[] }).__seen.some((t) => t.includes("Sent home") || t.includes("已送回家")), null, { timeout: 10_000 });

for (const c of [
  { tag: "G1", what: "stays, says the pet is on its way, then home, and closes on request", look: { lang: "en", scheme: "light", size: "phone" }, noLocks: false },
  { tag: "G1-no-locks", what: "does the same in a browser without Web Locks", look: { lang: "en", scheme: "dark", size: "desktop" }, noLocks: true },
] as const satisfies ReadonlyArray<{ tag: string; what: string; look: Look; noLocks: boolean }>) {
  test(`${c.tag}: the handheld's tab ${c.what} (${c.look.lang}, ${c.look.scheme}, ${c.look.size})`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player({ ...c.look, init: (c.noLocks ? NO_LOCKS : "") + SEEN });
    const { page } = p;
    const hh = await outWithOneSnack(p);
    await key(hh, "h", 500);
    if (c.noLocks) expect(await hh.evaluate(() => !("locks" in navigator)), "the browser has no Web Locks here").toBe(true);
    await bringHome(hh).click();
    await seenSentHome(hh);
    expect(hh.url(), "the handheld's tab stays the handheld, saying the pet is on its way").toContain("handheld.html");
    const ok = hh.locator(".hh-ok", { hasText: "Home" });
    await ok.waitFor({ timeout: 45_000 });
    await shot(hh, `${c.tag}-home`);
    await expect(ok, "the handheld's tab says the pet is home").toContainText("Home: your pet is back in your game");
    await expect(page.locator(".fam-modal").first(), "the game's tab brought it home").toContainText("Home from the handheld");
    await shot(page, `${c.tag}-game`);
    const closed = hh.waitForEvent("close", { timeout: 5_000 });
    // the button closes its own tab, so the click can be told the page is gone as it finishes: only a click that left
    // the tab open is a failure (CI, 56f49cc)
    await hh.locator("button.btn.primary", { hasText: "Close this tab" }).click().catch((e: unknown) => {
      if (!hh.isClosed()) throw e;
    });
    await closed;
    expect(hh.isClosed(), "the handheld's tab closes itself on request").toBe(true);
    expect(await elsewhere(page).count(), "no tab says the game is open elsewhere").toBe(0);
  });
}

test("G1-refused: the handheld's tab says the game kept the pet out, and the pet is still aboard (zh, dark, desktop)", async ({ player }) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop", init: SEEN });
  const { page } = p;
  const hh = await outWithOneSnack(p);
  await key(hh, "h", 500);
  // the packet is damaged on its way to the game
  await hh.evaluate((k) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
      if (name === k) {
        const b = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
        b[40] = (b[40] ?? 0) ^ 1;
        value = btoa(String.fromCharCode(...b));
        Storage.prototype.setItem = set;
      }
      return set.call(this, name, value);
    };
  }, RET);
  await bringHome(hh, true).click();
  await seenSentHome(hh);
  expect(hh.url(), "the handheld's tab stays the handheld, saying the pet is on its way").toContain("handheld.html");
  const bad = hh.locator(".hh-bad");
  await bad.waitFor({ timeout: 45_000 });
  await shot(hh, "G1-refused-refused");
  await expect(bad, "the handheld's tab says the game kept the pet out").toContainText("游戏没有接收宠物");
  await expect(page.locator(".fam-modal").first(), "the game's tab says why").toContainText("坏了");
  await hh.locator("button.btn", { hasText: "回到掌机" }).click();
  await bringHome(hh, true).waitFor({ timeout: 30_000 });
  await hh.waitForTimeout(BOOT_MS);
  await shot(hh, "G1-refused-back-aboard");
  await expect(bringHome(hh, true), "back on the handheld, the pet is still aboard and can be sent again").toBeEnabled();
  expect(await elsewhere(page).count(), "no tab says the game is open elsewhere").toBe(0);
});

test("G2: with no game tab open, the handheld's tab becomes the game and brings the pet home (zh, light, phone)", async ({ player }) => {
  test.setTimeout(240_000);
  const p = await player({ lang: "zh", scheme: "light", size: "phone", init: SEEN });
  const hh = await outWithOneSnack(p);
  await key(hh, "h", 500);
  await p.page.close();
  await bringHome(hh, true).click();
  await hh.waitForURL("**/play.html*", { timeout: 15_000 });
  await homeFromHandheld(hh).waitFor({ timeout: 45_000 });
  await shot(hh, "G2-game-in-handheld-tab");
  expect(await elsewhere(hh).count(), "it never says the game is open elsewhere").toBe(0);
  expect((await petOf(hh))?.away ?? null, "the pet is home in the save").toBeNull();
});
