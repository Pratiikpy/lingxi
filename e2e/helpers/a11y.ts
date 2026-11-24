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
  await page.evaluate(AXE);
  const all = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[]; failureSummary?: string }> }> }> } }).axe;
    const r = await axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => `${n.target.join(" ")} :: ${(n.failureSummary ?? "").split("\n").slice(1, 2).join(" ").trim()}`) }));
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
      const sel = ["button", "a[href]", "[role=button]", "[role=tab]", "[role=radio]", "[role=switch]", "input", "select"].map((s) => `${scope} ${s}`).join(", ");
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden" || (el as HTMLButtonElement).disabled || el.closest("[inert],[aria-hidden=true]")) continue;
        // an inline link inside running text is exempt (WCAG 2.5.8): it sits in a line of words, not on its own
        if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement && el.parentElement.textContent!.trim().length > el.textContent!.trim().length + 20) continue;
        if (r.width >= min - 0.5 && r.height >= min - 0.5) continue;
        // measured where a player would tap it: scrolled into view first
        el.scrollIntoView({ block: "center", inline: "center" });
        const at0 = el.getBoundingClientRect();
        const cx = at0.left + at0.width / 2;
        const cy = at0.top + at0.height / 2;
        const points = [-half, 0, half].flatMap((dx) => [-half, 0, half].map((dy) => [cx + dx, cy + dy] as const));
        const onScreen = points.every(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
        const hits = onScreen && points.every(([x, y]) => {
          const at = document.elementFromPoint(x, y);
          return !!at && (at === el || el.contains(at));
        });
        if (!hits) out.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    },
    { scope, min },
  );
}
