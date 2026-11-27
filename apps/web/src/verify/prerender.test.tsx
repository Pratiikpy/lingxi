// @vitest-environment node
/**
 * R39: the proof page as the build renders it, before any of its script and before X Layer has answered: its header,
 * explanation and pet-number box, the pet's card holding its place, and every section below it as it reads while its
 * checks are still to run. Nothing of the page waits on its script to be shown.
 */
import { describe, expect, it } from "vitest";

describe("the proof page rendered at build time (R39)", () => {
  it("draws every section of the page, the pet's card waiting for X Layer", async () => {
    // the page's modules read `location` as they load when no API address is built in, and the build renders each
    // language in its own copy of the modules: this one is the English page (i18n's initialLang), as the build gives it
    const g = globalThis as { location?: unknown; __lingxiPrerenderLang?: string };
    const had = "location" in g;
    if (!had) g.location = new URL("https://lingxi.invalid/");
    g.__lingxiPrerenderLang = "en";
    try {
      const { render } = await import("./prerender");
      const html = render();
      expect(html).toContain('<main class="verify">');
      expect(html).toContain("<h1>Verify a Lingxi pet</h1>");
      expect(html).toMatch(/<input id="pet-id" inputMode="numeric" value="1"\/>/);
      expect(html).toContain('class="v-card v-card-wait" aria-busy="true"');
      expect(html).toContain("Reading this pet from X Layer…");
      for (const section of [
        "Where these proofs come from",
        "Proof table",
        "Rule circuits",
        "Contracts and their source",
      ])
        expect(html, section).toContain(section);
      expect(html).toContain('class="site-foot"');
    } finally {
      if (!had) delete g.location;
      delete g.__lingxiPrerenderLang;
    }
  });
});
