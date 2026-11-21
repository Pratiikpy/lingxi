/**
 * The save file, made and restored as a player would. A player makes a file under a passphrase the game made for
 * them; the file holds nothing anyone could read. A fresh browser, from the hatch screen, refuses a wrong passphrase,
 * a file whose lock was weakened and a file that is not a save; the right passphrase shows what the file holds before
 * anything is replaced, then brings everything back, keys included. A browser with its own pet and key restores the
 * file, then undoes it, and no key is ever thrown away. Every step is checked in the save itself.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page } from "@playwright/test";
import { expect, hatch, test } from "../fixtures";
import { stored, storedJson } from "../helpers/browser";

const KEY_A = `0x${"2a".repeat(32)}`;
const KEY_C = `0x${"c3".repeat(32)}`;
const SESSION = "lingxi.session.v1";
const REPLACED = "lingxi.keys.replaced.v1";
/** A browser whose game already signs with its own key. */
const withKey = (key: string) => `if (!localStorage.getItem('${SESSION}')) localStorage.setItem('${SESSION}', '${key}');`;

interface PetsSave {
  pets: Array<{ name: string; bornAt: number; beat: number; lessons: unknown }>;
}
interface WorldSave {
  seed?: unknown;
  bag?: unknown;
  coins?: unknown;
}
type Replaced = Array<{ keys: Record<string, string> }>;

/** What one player made, for the players after it. */
const made: { file: string; phrase: string; pets: string; world: string } = { file: "", phrase: "", pets: "", world: "" };

/** Opens the save file sheet from the Pet sheet's card. */
async function openSaveFile(page: Page): Promise<void> {
  await page.locator(".tab[data-hint=tab-me]").click();
  // the save file sits behind the Pet tab's "Shops, friends and more" (H5)
  await page.locator(".me-more-open").click();
  await page.locator(".sf-card").waitFor();
  await page.locator(".sf-card .btn").click();
  await page.locator(".sf-part").first().waitFor();
}

/** Picks a file and a passphrase in the opener and opens it; a problem from before is gone once either changes. */
async function tryOpen(page: Page, file: string, phrase?: string): Promise<void> {
  const opener = page.locator(".sf-part:has(input[type=file])");
  await opener.locator("input[type=file]").setInputFiles(file);
  if (phrase !== undefined) await opener.locator("input[type=password]").fill(phrase);
  await expect(page.locator(".sf-bad"), "a new file or passphrase clears the last problem").toHaveCount(0);
  await opener.locator(".btn.primary").click();
}

/** Clicks and waits for the page to load again (a restore and an undo each start the game afresh). */
async function andReload(page: Page, click: () => Promise<void>): Promise<void> {
  const loaded = page.waitForEvent("load");
  await click();
  await loaded;
  await page.locator(".stage").waitFor({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test("a save file is made, holding nothing readable (en, light, phone)", async ({ player, run }) => {
  const p = await player({ lang: "en", scheme: "light", size: "phone", init: withKey(KEY_A) });
  const { page } = p;
  await hatch(p, "Kiri");
  await page.locator("[data-hint=look]").first().click();
  await page.waitForTimeout(600);
  await openSaveFile(page);

  const go = page.locator(".sf-part .btn.primary", { hasText: "Download" });
  await expect(go, "the download waits for a passphrase").toBeDisabled();
  await page.locator(".sf-field input").first().fill("short");
  await expect(page.locator(".sf-part").first(), "a short passphrase is refused, with how many characters are missing").toContainText("more characters");
  await page.locator(".btn", { hasText: "Make a strong one" }).click();
  const phrase = await page.locator(".sf-field input").first().inputValue();
  expect(phrase, "a strong passphrase is made and shown").toHaveLength(23);
  await expect(page.locator(".sf-warn"), "with the warning to keep it").toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath("savefile-make-en.png") });

  const downloading = page.waitForEvent("download");
  await go.click();
  const download = await downloading;
  const dir = join(run.dir, "save-file");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "a-save.json");
  await download.saveAs(file);
  await page.locator(".sf-ok").waitFor();
  const text = readFileSync(file, "utf8");
  const j = JSON.parse(text) as { kind?: string; kdf?: { rounds?: number }; zip?: string };
  expect(download.suggestedFilename(), "the file downloads under a dated name").toMatch(/^lingxi-save-.*\.json$/);
  expect(j.kind, "the file names its kind").toBe("lingxi-save");
  expect(j.kdf?.rounds, "and its lock").toBe(600_000);
  expect(j.zip).toBe("gzip");
  for (const secret of ["Kiri", "2a2a2a", "lingxi.pets"]) expect(text, `no pet name, key or save text can be read in the file (${secret})`).not.toContain(secret);
  Object.assign(made, { file, phrase, pets: (await stored(page, "lingxi.pets.v2"))!, world: (await stored(page, "lingxi.world.v1"))! });
});

test("a fresh browser refuses what is wrong, then restores everything (zh, dark, phone)", async ({ player, run }) => {
  expect(made.file, "the save file the first player made").not.toBe("");
  const p = await player({ lang: "zh", scheme: "dark", size: "phone" });
  const { page } = p;
  await page.goto(`${p.web}/play.html`);
  await page.locator(".hatch").waitFor({ timeout: 60_000 });
  await page.locator(".hatch-restore").click();
  await page.locator(".sf-part").first().waitFor();
  await page.screenshot({ path: test.info().outputPath("savefile-hatch-zh.png") });

  const last = made.phrase.at(-1)!;
  await tryOpen(page, made.file, made.phrase.slice(0, -1) + (last !== "a" ? "a" : "b"));
  await expect(page.locator(".sf-bad"), "a wrong passphrase is refused, in Chinese").toContainText("打不开");

  const j = JSON.parse(readFileSync(made.file, "utf8")) as { kdf: Record<string, unknown> };
  const changed = join(run.dir, "save-file", "a-save-changed.json");
  writeFileSync(changed, JSON.stringify({ ...j, kdf: { ...j.kdf, rounds: 100_000 } }));
  await tryOpen(page, changed, made.phrase);
  await expect(page.locator(".sf-bad"), "a file whose lock was weakened refuses to open").toContainText("打不开");

  const notASave = join(run.dir, "save-file", "not-a-save.json");
  writeFileSync(notASave, '{"hello": "world"}');
  await tryOpen(page, notASave);
  await expect(page.locator(".sf-bad"), "a file that is not a save is named as such").toContainText("不是灵犀的存档文件");

  await tryOpen(page, made.file);
  const summary = page.locator(".sf-sum");
  await expect(summary, "before anything is replaced, the file's pets are shown").toContainText("Kiri");
  await expect(summary, "and its keys").toContainText("保存它们的密钥");
  expect(await stored(page, "lingxi.pets.v2"), "nothing was written yet").toBeNull();
  await page.screenshot({ path: test.info().outputPath("savefile-check-zh-dark.png") });

  await andReload(page, () => page.locator(".sf-part .btn.primary", { hasText: "恢复" }).click());
  await expect(page.locator(".move-note"), "the game says it was restored").toContainText("已从存档文件恢复");
  const got = (await storedJson<PetsSave>(page, "lingxi.pets.v2"))!;
  const want = JSON.parse(made.pets) as PetsSave;
  const ids = (s: PetsSave) => s.pets.map((x) => [x.name, x.bornAt, x.lessons]);
  expect(ids(got), "the same pets came back").toEqual(ids(want));
  const world = (await storedJson<WorldSave>(page, "lingxi.world.v1"))!;
  const wantWorld = JSON.parse(made.world) as WorldSave;
  expect([world.seed, world.bag, world.coins], "the same world came back").toEqual([wantWorld.seed, wantWorld.bag, wantWorld.coins]);
  expect(await stored(page, SESSION), "and the key that saves them").toBe(KEY_A);
  // the pet lived on while the file sat on disk: its own clock moves it on, never back
  expect(got.pets[0]!.beat, "the restored pet carries on from where the file left it").toBeGreaterThanOrEqual(want.pets[0]!.beat);
  await page.screenshot({ path: test.info().outputPath("savefile-restored-zh-dark.png") });
});

test("a browser with its own pet restores, then undoes, and keeps every key (en, dark, desktop)", async ({ player }) => {
  expect(made.file, "the save file the first player made").not.toBe("");
  const p = await player({ lang: "en", scheme: "dark", size: "desktop", init: withKey(KEY_C) });
  const { page } = p;
  await hatch(p, "Momo");
  const petsHere = (await stored(page, "lingxi.pets.v2"))!;
  await openSaveFile(page);
  await tryOpen(page, made.file, `  ${made.phrase} `);
  const summary = page.locator(".sf-sum");
  await expect(summary, "the check names this browser's pets").toContainText("Momo");
  await expect(summary, "beside the file's").toContainText("Kiri");
  await page.screenshot({ path: test.info().outputPath("savefile-check-en-desktop.png") });

  await andReload(page, () => page.locator(".sf-part .btn.primary", { hasText: "Restore" }).click());
  expect(await stored(page, SESSION), "the restore brings the file's key").toBe(KEY_A);
  const replaced = (await storedJson<Replaced>(page, REPLACED)) ?? [];
  expect(replaced.some((e) => e.keys[SESSION] === KEY_C), "and keeps this browser's own").toBe(true);

  await andReload(page, () => page.locator(".move-note .btn", { hasText: "Undo" }).click());
  const ids = (raw: string | null) => ((raw ? JSON.parse(raw) : { pets: [] }) as PetsSave).pets.map((x) => [x.name, x.bornAt]);
  expect(ids(await stored(page, "lingxi.pets.v2")), "undo brings back this browser's pets").toEqual(ids(petsHere));
  expect(await stored(page, SESSION), "and its key").toBe(KEY_C);
  const after = (await storedJson<Replaced>(page, REPLACED)) ?? [];
  expect(after.some((e) => e.keys[SESSION] === KEY_A), "and the file's key is kept too: no key was thrown away").toBe(true);
});
