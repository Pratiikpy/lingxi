/**
 * R8 (plan 39, P5): the first minutes of the game with a real screen reader, in English and in Chinese. NVDA runs and
 * the keyboard plays as a blind player would: the hatch screen (an egg, an instinct, a name, hatch), the dialogs that
 * greet a new pet, then the room: the pet patted, fed from the bag Feed opens, cleaned, put to sleep and woken, two
 * sheets opened and closed. Keys go through NVDA, as they would from the player's own keyboard; the page is only read,
 * to know where the focus has got to and what the screen shows. Every phrase NVDA speaks is kept beside the run
 * (spoken-<lang>.txt), whether the run passes or not, and checked against what its first run (2026-11-26) found:
 *   - no control is read as its role alone, and each control on the way is read by its purpose;
 *   - after hatching the next words are the pet itself, not "document";
 *   - what each care did is said: the note on screen after a pat, a feed and a bath is heard;
 *   - a food's button says which food; a toggle has one name and a state; nothing is read twice over.
 * A third run reads a plain page, to tell what is NVDA's own way of speaking from what is ours.
 *
 * What the tool hears: Guidepup records NVDA's speech from a key press until NVDA has been quiet for a second. Words
 * said later than that with no key pressed (the pet's quiet line about a change, up to eight seconds on) are spoken
 * but not recorded, so nothing here is concluded from their absence.
 */
import { writeFileSync } from "node:fs";
import { NVDAKeyCodeCommands } from "@guidepup/guidepup";
import { nvdaTest as test } from "@guidepup/playwright";
import { expect, type Page } from "@playwright/test";

type Nvda = Parameters<Parameters<typeof test>[2]>[0]["nvda"];

const URL = process.env.LINGXI_SR_URL ?? "https://lingxi.knole.me";
/** How many times the knowledge card is tried when NVDA meets it with silence. */
const CARD_TRIES = 3;

/** A role NVDA speaks for a control; a phrase that is only roles names nothing. */
const ROLES =
  /^(button|toggle button|link|clickable|edit|editable|graphic|radio button|check box|switch|tab|menu button|按钮|链接|可点击|编辑框|图形|单选按钮|复选框)$/i;
const onlyRoles = (phrase: string): boolean => {
  const parts = phrase
    .split(/\.\s+|,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((s) => ROLES.test(s));
};

/**
 * Words as they are compared: NVDA, speaking English, reads Chinese punctuation its own way ("。" as "ideographic
 * period", "：" as ":"), so what was said and what was shown are compared without punctuation or spaces.
 */
const bare = (words: string): string =>
  words.replace(/ideographic (period|comma|full stop)/g, "").replace(/[\s.,:;·，。：；、!！?？]/g, "");

/** Presses Tab through NVDA until the focus is on an element matching `selector`. */
async function tabTo(nvda: Nvda, page: Page, selector: string, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return;
    await nvda.press("Tab");
  }
  const at = await page.evaluate(
    () =>
      `${document.activeElement?.tagName ?? "nothing"} "${(document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim().slice(0, 40)}", the page ${document.hasFocus() ? "has" : "has lost"} the keyboard`,
  );
  throw new Error(`the keyboard never reached ${selector} in ${max} presses; the focus is on ${at}`);
}

/** Closes each dialog that greets a new pet, with Enter on its own button, as the keyboard spec does. */
async function clearDialogs(nvda: Nvda, page: Page): Promise<void> {
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('[aria-modal="true"]:not(.sheet)').count())) return;
    await page.waitForTimeout(600);
    await tabTo(nvda, page, '[aria-modal="true"]:not(.sheet) .btn');
    await nvda.press("Enter");
    await page.waitForTimeout(800);
  }
}

/** The care note the screen shows now ("Kiko ate it all up."), once it is a new one (not `before`). */
async function noteShown(page: Page, before = ""): Promise<string> {
  let now = "";
  await expect
    .poll(
      async () => {
        const all = await page.locator(".toast:not(.world-toast)").allTextContents();
        now = all.map((x) => x.trim()).find((x) => x && x !== before) ?? "";
        return now;
      },
      { timeout: 10_000, message: "a care note comes up on screen" },
    )
    .not.toBe("");
  return now;
}

for (const look of [
  { lang: "en", scheme: "light" },
  { lang: "zh", scheme: "dark" },
] as const) {
  test.describe(`with NVDA (${look.lang}, ${look.scheme})`, () => {
    test.use({
      locale: look.lang === "zh" ? "zh-CN" : "en-US",
      colorScheme: look.scheme,
      nvdaStartOptions: { capture: true },
    });

    test(`the first minutes are told, control by control (${look.lang})`, async ({ page, nvda }) => {
      const t = (en: string, zh: string) => (look.lang === "zh" ? zh : en);
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
      await page.addInitScript(`localStorage.setItem('lingxi.lang', '${look.lang}')`);
      await page.goto(`${URL}/play.html`, { waitUntil: "load" });
      await page.locator(".hatch").first().waitFor({ timeout: 60_000 });
      await page.locator("div[data-prerender]").waitFor({ state: "detached", timeout: 60_000 });
      await nvda.navigateToWebContent();
      await nvda.clearSpokenPhraseLog();
      const notes: Record<string, string> = {};
      const shown = { food: "", rule: "" };
      let afterHatch = "";
      let cardTries = 0;

      try {
        // hatch: an egg, an instinct, a name typed through NVDA, and the hatch button
        await tabTo(nvda, page, ".egg:nth-child(2)");
        await nvda.press("Space");
        await expect(page.locator(".egg").nth(1)).toHaveAttribute("aria-checked", "true");
        await tabTo(nvda, page, ".instinct");
        await nvda.press("Space");
        await tabTo(nvda, page, "#pet-name");
        await nvda.press("Control+a");
        await nvda.type("Kiko");
        await expect(page.locator("#pet-name")).toHaveValue("Kiko");
        await tabTo(nvda, page, ".hatch-go");
        // Guidepup keeps what NVDA says for one second after a key; the egg takes longer than that to crack, so this
        // one key is pressed by the browser inside a capture that stays open until the room is drawn and the pet has
        // the focus, with no other key pressed: what is said in it is what a blind player hears after hatching
        const hatching = await nvda.capture(async () => {
          await page.keyboard.press("Enter");
          await page.locator(".stage").waitFor({ timeout: 60_000 });
          await expect(page.locator(".pet-button"), "after hatching the focus is on the pet").toBeFocused();
          await page.waitForTimeout(2_000);
        });
        afterHatch = hatching.spokenPhrase;
        await clearDialogs(nvda, page);

        // the room: the pet patted, fed from the bag, cleaned, put to sleep and woken
        await tabTo(nvda, page, ".pet-button");
        await nvda.press("Enter");
        notes.pat = await noteShown(page);
        await page.waitForTimeout(3_000);
        await tabTo(nvda, page, ".act[data-hint=feed]");
        await nvda.press("Enter");
        await page.locator(".sheet").waitFor();
        await tabTo(nvda, page, ".sheet .bag-item .btn");
        shown.food = (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) ?? "";
        await nvda.press("Enter");
        notes.feed = await noteShown(page, notes.pat);
        await page.waitForTimeout(3_000);
        if (await page.locator(".sheet").count()) await nvda.press("Escape");
        await expect(page.locator(".sheet")).toHaveCount(0);
        await clearDialogs(nvda, page);
        await tabTo(nvda, page, ".act[data-hint=clean]");
        await nvda.press("Enter");
        notes.clean = await noteShown(page, notes.feed);
        await page.waitForTimeout(3_000);
        const sleep = page.locator(".act[data-hint=sleep]");
        const awake = (await sleep.textContent()) ?? "";
        await tabTo(nvda, page, ".act[data-hint=sleep]");
        await nvda.press("Enter");
        await expect(sleep).not.toHaveText(awake);
        await page.waitForTimeout(3_000);
        await nvda.press("Enter");
        await expect(sleep).toHaveText(awake);
        await page.waitForTimeout(3_000);
        // what the pet knows, read as a blind player reads a card: Tab to it, then line by line (NVDA's down arrow).
        // The first rule is heard as its sentence, not as chips run together.
        shown.rule = ((await page.locator(".mindcard .rules li .sr-only").first().textContent()) ?? "").trim();
        await tabTo(nvda, page, ".mindcard .pad");
        // NVDA reads a page in its browse mode; after a radio button or a text box it may be in focus mode, where the
        // arrow keys go to the page instead (Escape leaves it). The room is never still (its clock, its notices), and
        // NVDA keeps its own copy of the page up to date as it changes: keys pressed straight after the Tab found that
        // copy mid-update in four runs of six and were met with silence. So it is given two seconds to settle, as a
        // player's pause would, and a card met with silence is tabbed away from and back to, up to three tries; how
        // many it took is kept with the run, so a card that needs more than one is seen.
        for (let attempt = 1; attempt <= CARD_TRIES; attempt++) {
          await page.waitForTimeout(2_000);
          await nvda.perform(NVDAKeyCodeCommands.exitFocusMode);
          const before = (await nvda.spokenPhraseLog()).length;
          for (let i = 0; i < 4; i++) await nvda.next();
          const read = (await nvda.spokenPhraseLog()).slice(before).join(" ");
          cardTries = attempt;
          if (bare(read).includes(bare(shown.rule))) break;
          await nvda.press("Shift+Tab");
          await tabTo(nvda, page, ".mindcard .pad");
        }
        for (const tab of ["me", "mind"]) {
          await tabTo(nvda, page, `.tab[data-hint=tab-${tab}]`);
          await nvda.press("Enter");
          await page.locator(".sheet").waitFor();
          await page.waitForTimeout(1_500);
          await nvda.press("Escape");
          await expect(page.locator(".sheet")).toHaveCount(0);
        }
      } finally {
        // what was said is kept whether the run passed or not: a failure is read from it
        const log = await nvda.spokenPhraseLog();
        writeFileSync(test.info().outputPath(`spoken-${look.lang}.txt`), log.join("\n"), "utf8");
        await page.screenshot({ path: test.info().outputPath(`room-${look.lang}.png`) });
      }

      const spoken = await nvda.spokenPhraseLog();
      const said = spoken.join("\n");
      const heard = bare(said);
      expect(spoken.filter(onlyRoles), "a control read as its role alone, with no name").toEqual([]);
      // each control on the way is read by its purpose, in the page's language
      for (const words of [
        t("Hatch", "孵化"),
        t("Pat Kiko", "摸摸Kiko"),
        t("Feed", "喂食"),
        t("Clean", "洗澡"),
        t("Sleep", "睡觉"),
      ])
        expect(heard, `NVDA said "${words}"`).toContain(bare(words));
      // after hatching, what is said next is the pet: its button, its age and what it is doing
      expect(bare(afterHatch), `the words after hatching are the pet: ${afterHatch}`).toContain(
        bare(t("Pat Kiko", "摸摸Kiko")),
      );
      // what each care did is heard, in the words the screen showed
      for (const [care, note] of Object.entries(notes)) {
        expect(note, `the screen showed a note after the ${care}`).not.toBe("");
        expect(heard, `the note after the ${care} was heard: ${note}`).toContain(bare(note));
      }
      // a food's button says which food; a rule is read as a sentence; a toggle has one name
      expect(shown.food, "the bag's button names its food").toMatch(look.lang === "zh" ? /^喂食：\S/ : /^Feed: \S/);
      expect(heard, `the food's button was heard by its name: ${shown.food}`).toContain(bare(shown.food));
      expect(heard, "the sound toggle has one name").toContain(bare(t("Sound, toggle button", "声音, toggle button")));
      expect(heard).not.toMatch(/Sound(on|off)togglebutton|声音(开|关)/);
      expect(said, "the egg's tick is not read").not.toMatch(/\bcheck, radio button/);
      // A dialog is said twice by NVDA itself ("Bag, dialog. Close, button. Bag, dialog. button, Close": the focus,
      // then the dialog's own words): the plain page below says its dialog the same way, so it is not checked here.
      expect(errors, "console errors").toEqual([]);
      // last, so every check above is judged whatever this one finds
      writeFileSync(test.info().outputPath(`card-tries-${look.lang}.txt`), `${cardTries}\n`, "utf8");
      expect(shown.rule, "a rule has its sentence").not.toBe("");
      expect(heard, `the rule was heard as its sentence (${cardTries} tries): ${shown.rule}`).toContain(
        bare(shown.rule),
      );
    });
  });
}

test.describe("with NVDA, a plain page", () => {
  test.use({ nvdaStartOptions: { capture: true } });

  test("what NVDA says of a page that is not ours", async ({ page, nvda }) => {
    // two buttons and a dialog that takes the focus on its Close button, as the game's sheets do
    await page.goto(
      `data:text/html,<title>Plain</title><main><h1>Plain</h1><button>One</button><button onclick="d.hidden=false;c.focus()">Open</button><div id="d" role="dialog" aria-modal="true" aria-label="Box" hidden><button id="c" aria-label="Close">x</button><p>Words in the box</p></div></main>`,
    );
    await nvda.navigateToWebContent();
    await nvda.clearSpokenPhraseLog();
    for (let i = 0; i < 12; i++) await nvda.press("Tab");
    for (let i = 0; i < 12 && !(await page.evaluate(() => document.activeElement?.textContent === "Open")); i++)
      await nvda.press("Tab");
    await nvda.press("Enter");
    await page.waitForTimeout(2_000);
    const spoken = await nvda.spokenPhraseLog();
    writeFileSync(test.info().outputPath("spoken-plain.txt"), spoken.join("\n"), "utf8");
    expect(spoken.join("\n")).toContain("One");
  });
});
