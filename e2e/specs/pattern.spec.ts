/**
 * "Follow the Pattern" shows every light clearly on any device (A9). Every 180 ms timer in the page is held back
 * 300 ms, as on a slow phone, so the light of the player's last press would outlast the start of the next showing.
 * Each round's lights are timed as they come and go: each stays on its full half step, starts only after a dark pause,
 * and the player's last press never runs into the first light.
 */
import { dismiss, expect, hatch, test } from "../fixtures";

/** Holds back every 180 ms timer (a press's light) by 300 ms. */
const SLOW_PHONE = "{ const t = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...a) => t(fn, ms === 180 ? 480 : ms, ...a); }";

type Light = { pad: number; on: number; off: number };

for (const o of [
  { lang: "en", scheme: "light", size: "phone", reducedMotion: false },
  { lang: "zh", scheme: "dark", size: "desktop", reducedMotion: false },
  { lang: "en", scheme: "dark", size: "phone", reducedMotion: true },
] as const) {
  test(`the pattern game shows every light clearly on a slow phone (${o.lang}, ${o.scheme}, ${o.size}${o.reducedMotion ? ", less motion" : ""})`, async ({ player }) => {
    const p = await player({ ...o, init: SLOW_PHONE });
    const { page } = p;
    await hatch(p, "Pip");
    await page.locator("button.act[data-hint=play]").click();
    await page.locator(".game-card").nth(1).click();
    const half = (o.reducedMotion ? 700 : 560) / 2;

    for (let round = 1; round <= 3; round++) {
      // each light of the showing, with the time it came on and went out, and when the pads closed to input
      const { lights, closedAt } = await page.evaluate(
        () =>
          new Promise<{ lights: Light[]; closedAt: number }>((resolve) => {
            const pads = () => [...document.querySelectorAll<HTMLButtonElement>(".pads .pad")];
            const lights: Light[] = [];
            let closedAt = -1;
            let showing = false;
            const watcher = new MutationObserver((records) => {
              const now = performance.now();
              const ps = pads();
              const closed = ps.length > 0 && ps[0]!.disabled;
              if (closed && !showing) closedAt = now;
              const ended = showing && !closed;
              showing = closed || ended;
              for (const r of records) {
                const el = r.target as HTMLButtonElement;
                if (r.attributeName !== "class" || !el.classList?.contains("pad")) continue;
                const was = (r.oldValue ?? "").split(" ").includes("lit");
                const is = el.classList.contains("lit");
                if (is && !was && showing) lights.push({ pad: pads().indexOf(el), on: now, off: -1 });
                if (was && !is) {
                  const pad = pads().indexOf(el);
                  const l = [...lights].reverse().find((x) => x.pad === pad && x.off < 0);
                  if (l) l.off = now;
                }
              }
              if (ended) {
                watcher.disconnect();
                resolve({ lights, closedAt });
              }
              showing = closed;
            });
            watcher.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "disabled"], attributeOldValue: true });
            showing = pads().length > 0 && pads()[0]!.disabled;
            if (showing) closedAt = performance.now();
          }),
      );
      expect(lights.map((l) => l.pad).length, `round ${round} shows ${round} lights`).toBe(round);
      expect(lights[0]!.on - closedAt, `round ${round}: a dark pause before the first light`).toBeGreaterThanOrEqual(half);
      for (const l of lights) expect(l.off - l.on, `round ${round}: each light stays on its half step`).toBeGreaterThanOrEqual(half - 40);
      if (round < 3) for (const l of lights) await page.locator(".pads .pad").nth(l.pad).click();
      else await page.locator(".pads .pad").nth((lights[0]!.pad + 1) % 4).click();
    }
    await expect(page.locator(".game-result")).toContainText(p.t("Score 2", "得分 2"));
    await page.screenshot({ path: test.info().outputPath(`pattern-${o.lang}-${o.scheme}-${o.size}${o.reducedMotion ? "-less-motion" : ""}.png`) });
    await page.locator(".games .btn").last().click();
    await dismiss(page);
  });
}
