/**
 * A proven season entry: a pet kept on X Layer enters this week's season as itself, signed by its keeper, and the
 * server checks its brain against the one on chain before marking it proven. After the pet learns something its mind
 * on chain lacks, it still enters, unproven, and the game says why it cannot win the keepsake. A pet that lives only
 * in the browser enters openly. Each entry is read back from the server's season store, not only from the screen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Opened, dismiss, expect, hatch, sheet, test } from "../fixtures";
import { forkOf, keepOnChain, reach, teach } from "../helpers/chain";

/** The season store the server writes: week → its entries and its proven pets (entry key → pet id). */
const stored = (dir: string) => JSON.parse(readFileSync(join(dir, "stores", "season.json"), "utf8")) as Record<string, { entries: Array<{ key: string }>; pets?: Record<string, string> }>;
/** This device's entry key for `week`, as the game remembers it. */
const myKey = (page: Opened["page"], week: string) => page.evaluate((w) => (JSON.parse(localStorage.getItem("lingxi.season.v1") ?? "{}") as { keys?: Record<string, string> }).keys?.[w], week);

/** Opens the Spar tab, where the season lives, and returns its line about the keepsake. */
async function openSeason(page: Opened["page"]) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".tab[data-hint=tab-spar]").click();
  return reach(page, ".ss-prize");
}

/**
 * Taps the season's enter button and returns the note the entry leaves. The note on screen before the tap is marked,
 * so the wait ends on the new one, written once the server has answered.
 */
async function enter(page: Opened["page"]): Promise<string> {
  await page.evaluate(() => document.querySelector(".ss-note")?.setAttribute("data-before", ""));
  const button = page.locator(".ss-card .ss-head .btn.primary");
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const note = page.locator(".ss-note:not([data-before])");
  await note.waitFor({ timeout: 180_000 });
  return note.innerText();
}

test("a pet on X Layer enters the season proven, then honestly unproven (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(5 * 60_000);
  await forkOf(run);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Kiri");
  await sheet(page, "me");
  const { petId } = await keepOnChain(page);

  const prize = await (await openSeason(page)).innerText();
  expect(prize, "the season says how the keepsake works for a pet on X Layer").toContain("sign once");
  await expect(page.locator(".ss-card .ss-head .btn.primary"), "the season is read and open").toBeEnabled();
  const note = await enter(page);
  const weeks = stored(run.dir);
  const week = Object.keys(weeks).sort().at(-1)!;
  expect(Object.values(weeks[week]?.pets ?? {}), "the server holds the entry as this pet, proven").toContain(petId);
  expect(note, "the game says it is entered as itself").toContain("as itself");

  // it learns something its mind on chain lacks: still entered, and told why it can't win the keepsake
  await teach(page, { when: { hunger: [3], joy: [1] }, then: { want: 4, mood: 1 } });
  await page.reload();
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
  await openSeason(page);
  await expect(page.locator(".ss-card .ss-head .btn.primary"), "the entry can be updated").toHaveText("Update entry");
  const note2 = await enter(page);
  expect(note2, "a mind behind the chain is entered with the reason it can't win").toContain("behind");
  const after = stored(run.dir)[week];
  expect(after?.entries.map((e) => e.key), "the server still holds the entry").toContain(await myKey(page, week));
  expect(Object.values(after?.pets ?? {}), "but no longer as this pet, proven").not.toContain(petId);
  await page.screenshot({ path: test.info().outputPath("season-behind-en-light-phone.png") });
});

test("a pet kept only in the browser enters the season openly (zh, light, phone)", async ({ player, run }) => {
  const p = await player({ lang: "zh", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Mo");
  const prize = await (await openSeason(page)).innerText();
  expect(prize, "the season tells a browser-only pet to go on X Layer to be in line").toContain("放上 X Layer");
  await expect(page.locator(".ss-card .ss-head .btn.primary")).toHaveText("让Mo参赛");
  const note = await enter(page);
  expect(note, "the pet is in this week's season").toContain("参加本周赛季");
  const weeks = stored(run.dir);
  const week = Object.keys(weeks).sort().at(-1)!;
  const key = await myKey(page, week);
  expect(weeks[week]?.entries.map((e) => e.key), "the server holds this entry").toContain(key);
  expect(Object.keys(weeks[week]?.pets ?? {}), "and holds it as open, not proven").not.toContain(key);
  await page.screenshot({ path: test.info().outputPath("season-zh-light-phone.png") });
});

for (const look of [
  { lang: "en", scheme: "light", size: "phone", said: "Lingxi is checking many pets against X Layer just now, so nothing was entered." },
  { lang: "zh", scheme: "dark", size: "desktop", said: "灵犀正在对照 X Layer 核对很多只宠物，所以这次没有参赛。" },
] as const) {
  test(`a proof the server cannot check just now enters nothing and says to try again (${look.lang}, ${look.scheme}, ${look.size}) (A62)`, async ({ player, run }) => {
    test.setTimeout(5 * 60_000);
    await forkOf(run);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await hatch(p, "Kiri");
    await sheet(page, "me");
    await keepOnChain(page);
    await openSeason(page);
    // the server's answer when its checks are full, as it words it
    const sent: string[] = [];
    await page.route(
      (u) => u.pathname === "/api/season/enter",
      (route) => (sent.push(route.request().postData() ?? ""), route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason: "notProven", detail: "busy" }) })),
    );
    const note = await enter(page);
    expect(note).toContain(look.said);
    expect(sent, "and the game does not enter it unproven instead").toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath(`season-busy-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
