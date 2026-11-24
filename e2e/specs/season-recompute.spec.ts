/**
 * A84: recomputing the season in the browser. A full week of 64 heavy minds (each card's instinct at its gate budget,
 * with the most lessons a card holds) is every pet against every other from both sides, seconds of work; it used to be
 * fought on the page's main thread and froze the game for all of it. It is fought in a worker now: while it runs the
 * page keeps answering (no task on the main thread over 200 ms), the button says it is re-fighting, and the answer is
 * the same table the server published.
 */
import { NAND, REF, bytesToHex, encode, type Element } from "../../packages/brain/src";
import {
  MAX_LESSONS,
  canonicalCard,
  seasonStandings,
  standingsDigest,
  weekOf,
  type SeasonEntry,
} from "../../packages/game/src";
import { type Opened, expect, hatch, test } from "../fixtures";

const cpu = `0x${"ab".repeat(20)}`;
const hex = (els: Element[]) => bytesToHex(encode(els)).slice(2);

/** An owned instinct at the gate budget: three references to a part of 999 NANDs (the reviewer's heavy card). */
function instinct(seed: number) {
  const nands: Element[] = Array.from(
    { length: 999 },
    (_, i) => ({ op: NAND, ins: [17 + i, 2 + ((i + seed) % 16)], nOut: 1, firstOut: 18 + i }) as Element,
  );
  const ins = Array.from({ length: 16 }, (_, i) => 2 + i);
  const top: Element[] = Array.from(
    { length: 3 },
    (_, k) => ({ op: REF, ins, cpu, id: BigInt(1000 + seed), nOut: 8, firstOut: 18 + 8 * k }) as Element,
  );
  return {
    processor: cpu,
    id: String(seed + 1),
    owner: "",
    parts: [
      { processor: cpu, id: String(seed + 1), nIn: 16, nOut: 8, hex: hex(top) },
      { processor: cpu, id: String(1000 + seed), nIn: 16, nOut: 8, hex: hex(nands) },
    ],
  };
}
const lessons = (i: number) =>
  Array.from({ length: MAX_LESSONS }, (_, j) => ({
    when: { hunger: [(i + j) % 4], joy: [(i * 3 + j) % 4] },
    then: { want: (i + j) % 8, mood: (i + 2 * j) % 4 },
  }));

const entries: SeasonEntry[] = Array.from({ length: 64 }, (_, i) => ({
  key: `k${String(i).padStart(2, "0")}`,
  at: i,
  pet: {
    name: `H${i}`,
    line: (["gentle", "bold", "curious"] as const)[i % 3]!,
    stage: "adult",
    card: canonicalCard(JSON.stringify({ lessons: lessons(i), outside: instinct(i) }))!,
    story: { days: 30, lessons: MAX_LESSONS, nature: [] },
  },
}));

/**
 * The season as the server would publish it, fought here before the page opens (seconds of work that would otherwise
 * stall this test's own process mid-route). The game's week may lag the wall clock by a day on the test chain, so both
 * candidate weeks are fought; any other week (last week's) has no season.
 */
const published = new Map<string, object>();
function publish(week: string) {
  if (published.has(week)) return;
  const standings = seasonStandings(week, entries);
  published.set(week, {
    ok: true,
    week,
    closed: false,
    ends: Date.now() + 3 * 86_400_000,
    entries,
    standings,
    digest: standingsDigest(standings),
  });
}

async function openSeason(page: Opened["page"]) {
  await page.route(/\/api\/season\/\d{4}-W\d{2}$/, async (route) => {
    const week = new URL(route.request().url()).pathname.split("/").pop()!;
    await route.fulfill({ json: published.get(week) ?? { ok: false, reason: "none" } });
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".tab[data-hint=tab-spar]").click();
  const button = page.locator(".ss-check button");
  await button.waitFor({ timeout: 60_000 });
  await button.scrollIntoViewIfNeeded();
  return button;
}

for (const look of [
  { lang: "en", scheme: "light", size: "phone", busy: "Re-fighting all 4,032 bouts", same: "Same table" },
  { lang: "zh", scheme: "dark", size: "desktop", busy: "正在重打全部 4,032 场", same: "同一张表" },
] as const) {
  test(`a full week of heavy minds is recomputed without freezing the page (${look.lang}, ${look.scheme}, ${look.size}) (A84)`, async ({
    player,
  }) => {
    test.setTimeout(6 * 60_000);
    for (const t of [Date.now(), Date.now() - 2 * 86_400_000]) publish(weekOf(t));
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await hatch(p, "Kiri");
    const button = await openSeason(page);
    // every task the page's main thread runs from here is measured
    await page.evaluate(() => {
      const w = window as unknown as { longest: number };
      w.longest = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.longest = Math.max(w.longest, e.duration);
      }).observe({ type: "longtask", buffered: false });
    });
    await button.click();
    await expect(button, "it says it is re-fighting, and cannot be pressed twice").toContainText(look.busy);
    await expect(button).toBeDisabled();
    await page.screenshot({
      path: test.info().outputPath(`season-refighting-${look.lang}-${look.scheme}-${look.size}.png`),
    });
    // the page answers while the worker fights: a tap on the tab bar is handled at once
    const answered = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          const t = performance.now();
          requestAnimationFrame(() => done(performance.now() - t));
        }),
    );
    expect(answered, "a frame is drawn while the season is refought").toBeLessThan(200);
    const result = page.locator(".ss-check .ss-ok");
    await result.waitFor({ timeout: 120_000 });
    expect(await result.innerText(), "the same table the server published").toContain(look.same);
    await expect(button).toBeEnabled();
    const longest = await page.evaluate(() => (window as unknown as { longest: number }).longest);
    expect(longest, "no task on the main thread over 200 ms while 4,032 bouts were refought").toBeLessThan(200);
    await page.screenshot({ path: test.info().outputPath(`season-same-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
