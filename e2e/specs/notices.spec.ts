/**
 * A15: the room's notices never pile up. With the rules mark, a quest's "done" toast and the pet's own line all showing
 * at once, no two overlap, and none covers the room's top row (Home, Look around, Decorate) or the pet's "!".
 */
import { type Page } from "@playwright/test";
import { type Opened, expect, hatch, patPet, tapMoving, test } from "../fixtures";

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The boxes of the notices, the room's top-row buttons and the pet's mark, all read in one moment (notices come and go). */
const boxesNow = (page: Page): Promise<Record<"notices" | "buttons" | "marks", Box[]>> =>
  page.evaluate(() => {
    const of = (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
    return { notices: of(".quest-toast, .badge-toast, .toast:not(.world-toast), .rules-mark"), buttons: of(".room-pill button"), marks: of(".pet-quest") };
  });

/** Takes the pet's first quest, as its "!" offers it: its lines tapped through, then "Okay!" (as quests.spec does). */
async function takeFirstQuest(p: Opened): Promise<void> {
  await tapMoving(p.page.locator(".pet-quest"));
  const dialog = p.page.locator(".fam-card.qd");
  await dialog.waitFor();
  const go = dialog.locator(".btn.primary", { hasText: p.t("Okay!", "好呀！") });
  for (let i = 0; i < 8 && !(await go.count()); i++) {
    await dialog.locator(".qd-bubble").click();
    await p.page.waitForTimeout(250);
  }
  await go.click();
  await dialog.waitFor({ state: "detached" });
}

async function checkLayout(page: Page, tag: string): Promise<void> {
  // each notice slides a few pixels into its place as it appears: measure once they have arrived
  await page.waitForTimeout(600);
  const { notices, buttons, marks } = await boxesNow(page);
  expect(notices.length, "at least three notices are showing together").toBeGreaterThanOrEqual(3);
  for (let i = 0; i < notices.length; i++)
    for (let j = i + 1; j < notices.length; j++) expect(overlap(notices[i]!, notices[j]!), `notices ${i} and ${j} overlap`).toBe(false);
  for (const button of buttons)
    for (const n of notices) expect(overlap(n, button), "a notice covers the room's top row").toBe(false);
  for (const mark of marks) for (const n of notices) expect(overlap(n, mark), "a notice covers the pet's mark").toBe(false);
  await page.screenshot({ path: test.info().outputPath(`notices-${tag}.png`) });
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone" },
  { lang: "zh", scheme: "dark", size: "desktop" },
] as const) {
  test(`the room's notices stack, clear of its buttons (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(240_000);
    const p = await player(look);
    const { page } = p;
    await hatch(p, "Pip");
    await takeFirstQuest(p);
    // the rules are checked as the game opens: open it afresh, then finish the quest while the mark still shows
    await page.reload();
    await page.locator(".stage").waitFor();
    await expect(page.locator(".rules-mark")).toBeVisible({ timeout: 30_000 });
    for (let i = 0; i < 3; i++) await patPet(page);
    await expect(page.locator(".quest-toast")).toBeVisible();
    await checkLayout(page, `${look.lang}-${look.scheme}-${look.size}`);
  });
}
