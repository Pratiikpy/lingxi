// @vitest-environment node
/**
 * R39: the handheld page as the build renders it, before any of its script: the header, the device with every one of its
 * keys, and what the device is doing, in one render for a browser with a pet coming aboard and one for a browser
 * without (the page's first script picks between them by the storage keys this module names).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEVICE_KEY, INBOX_KEY } from "../game/handheldKeys";

let mod: { render: (aboard: boolean) => string; variantKeys: readonly string[] };

beforeAll(async () => {
  // the build renders each language in its own copy of the modules; this one is the English page (i18n's initialLang)
  (globalThis as { __lingxiPrerenderLang?: string }).__lingxiPrerenderLang = "en";
  try {
    mod = await import("./prerender");
  } finally {
    delete (globalThis as { __lingxiPrerenderLang?: string }).__lingxiPrerenderLang;
  }
});

describe("the handheld rendered at build time (R39)", () => {
  it("draws the page's header, the device's screen and all seventeen keys", () => {
    const html = mod.render(false);
    expect(html).toContain('class="hh-head"');
    expect(html).toContain('<canvas class="hh-screen" width="240" height="135"');
    expect(html.match(/class="hh-key( wide)?"/g)).toHaveLength(17);
    expect(html).toContain('class="site-foot"');
  });

  it("says it is waking, or that it is bringing a pet aboard when one is coming", () => {
    expect(mod.render(false)).toContain("Waking the handheld…");
    expect(mod.render(false)).not.toContain("Bringing your pet aboard…");
    expect(mod.render(true)).toContain("Bringing your pet aboard…");
  });

  it("names the keys the page reads to tell a pet is coming: its inbox and a trip kept across a reload", () => {
    expect([...mod.variantKeys].sort()).toEqual([DEVICE_KEY, INBOX_KEY].sort());
  });
});
