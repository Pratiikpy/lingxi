/**
 * P5: axe (axe-core, pinned in the repo) run on a page as it stands. It is put into the page through the browser's
 * debugging protocol, as page.evaluate does, so the site's own script policy stays on while it is checked.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

// the browser suite is loaded as CommonJS, so Node's own resolver is at hand
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

export interface Finding {
  id: string;
  impact: string | null;
  nodes: string[];
}

/** axe's serious and critical findings on what the page shows now, each with the elements it names. */
export async function seriousFindings(page: Page): Promise<Finding[]> {
  const first = await findingsAtRest(page);
  if (!first.some((f) => f.id === "color-contrast")) return first;
  // a notice may arrive after the page came to rest and be measured mid-fade (the badge toast over the Pet sheet read
  // 1.06:1 for text that is 13:1 at rest): contrast is judged again once the page is at rest, and only what is still
  // wrong is kept
  await page.waitForTimeout(800);
  return findingsAtRest(page);
}

async function findingsAtRest(page: Page): Promise<Finding[]> {
  // contrast is judged at rest: wait for every animation that ends to end, whether the browser runs it or a script
  // writes it into an inline style (a panel fading in measured mid-fade on a slow CI runner read 3.7:1, P6b)
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => a.playState !== "running" || !Number.isFinite(Number(a.effect?.getComputedTiming().endTime))) &&
      [...document.querySelectorAll<HTMLElement>("[style*='opacity']")].every((el) => {
        // decoration hidden from assistive technology may loop its fade for ever (the landing's hearts); it is not read
        if (el.closest("[aria-hidden='true']")) return true;
        const o = Number(el.style.opacity);
        return !(o > 0 && o < 1);
      }),
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(AXE);
  const all = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: Document,
            o: object,
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[]; failureSummary?: string }>;
            }>;
          }>;
        };
      }
    ).axe;
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map(
        (n) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim()}`,
      ),
    }));
  });
  return all.filter((f) => f.impact === "serious" || f.impact === "critical");
}

/**
 * Every visible, enabled control under `scope` whose touch area is under `min` CSS pixels either way: a control passes
 * when it is drawn that large, or when every point of a `min`-pixel square around its centre lands on it (an invisible
 * area around a smaller drawing counts, as it does for a finger). Each failure names the control and its drawn size.
 */
export async function smallTargets(page: Page, scope: string, min = 44): Promise<string[]> {
  return page.evaluate(
    ({ scope, min }) => {
      const out: string[] = [];
      const half = min / 2 - 1;
      const sel = [
        "button",
        "a[href]",
        "[role=button]",
        "[role=tab]",
        "[role=radio]",
        "[role=switch]",
        "input",
        "select",
      ]
        .map((s) => `${scope} ${s}`)
        .join(", ");
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        if (
          !r.width ||
          !r.height ||
          getComputedStyle(el).visibility === "hidden" ||
          (el as HTMLButtonElement).disabled ||
          el.closest("[inert],[aria-hidden=true]")
        )
          continue;
        // an inline link inside running text is exempt (WCAG 2.5.8): it sits in a line of words, not on its own
        if (
          el.tagName === "A" &&
          getComputedStyle(el).display === "inline" &&
          el.parentElement &&
          el.parentElement.textContent!.trim().length > el.textContent!.trim().length + 20
        )
          continue;
        if (r.width >= min - 0.5 && r.height >= min - 0.5) continue;
        // measured where a player would tap it: scrolled into view first
        el.scrollIntoView({ block: "center", inline: "center" });
        const at0 = el.getBoundingClientRect();
        const cx = at0.left + at0.width / 2;
        const cy = at0.top + at0.height / 2;
        const points = [-half, 0, half].flatMap((dx) => [-half, 0, half].map((dy) => [cx + dx, cy + dy] as const));
        const onScreen = points.every(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
        // a probe that lands on something else names it, so a failure says what was on top (CI, 2026-11-25)
        let cover = "";
        const hits =
          onScreen &&
          points.every(([x, y]) => {
            const at = document.elementFromPoint(x, y);
            const ok = !!at && (at === el || el.contains(at));
            if (!ok && !cover)
              cover = at
                ? ` covered at ${Math.round(x)},${Math.round(y)} by ${at.tagName.toLowerCase()}.${(at.className || "").toString().split(" ")[0]} "${(at.textContent || "").trim().slice(0, 24)}"`
                : ` nothing at ${Math.round(x)},${Math.round(y)}`;
            return ok;
          });
        if (!hits)
          out.push(
            `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}${onScreen ? cover : " off screen"}`,
          );
      }
      return out;
    },
    { scope, min },
  );
}

/**
 * R8: buttons in one list that a screen reader would read alike. Each row's button must say what it acts on
 * ("Feed: Rice ball"); rows whose buttons are all called "Feed" are told apart by sight alone, and NVDA read a bag of
 * three foods as "Feed, button" three times. Returns each name that more than one row of a list gives a button,
 * under `scope`, with how many rows and which list.
 */
export async function sameNamedRowButtons(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = [];
    for (const list of Array.from(document.querySelectorAll<HTMLElement>(`${scope} ul, ${scope} ol`))) {
      if (!list.getClientRects().length || list.closest("[aria-hidden=true],[inert]")) continue;
      const rows = new Map<string, number>();
      for (const row of Array.from(list.children)) {
        const inRow = new Set<string>();
        for (const b of Array.from(row.querySelectorAll<HTMLElement>("button, a[href], [role=button]"))) {
          // a list inside a row is counted on its own
          if (b.closest("ul, ol") !== list || !b.getClientRects().length) continue;
          const name = (b.getAttribute("aria-label") ?? b.textContent ?? "").replace(/\s+/g, " ").trim();
          if (name) inRow.add(name);
        }
        for (const n of inRow) rows.set(n, (rows.get(n) ?? 0) + 1);
      }
      for (const [n, c] of rows)
        if (c > 1)
          out.push(`"${n}" on ${c} rows of ${list.tagName.toLowerCase()}.${list.className.split(" ")[0] ?? ""}`);
    }
    return out;
  }, scope);
}
