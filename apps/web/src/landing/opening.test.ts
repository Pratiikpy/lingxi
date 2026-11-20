/**
 * A86: the opening sentence says what holds, wherever it is said. Every pet's mind is a circuit of NAND gates and
 * latches; only once its owner keeps it on X Layer is that circuit taped out there (A43). The old sentence (every
 * pet's brain is a circuit on X Layer) is read for in every public text that carries the opening: the pages' meta
 * descriptions, the web manifest, the landing's first lines, the agent API's own description and the README banner's
 * source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COPY } from "./copy";

const root = join(__dirname, "../../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const PUBLIC = ["apps/web/index.html", "apps/web/play.html", "apps/web/verify.html", "apps/web/handheld.html", "apps/web/agents.html", "apps/web/public/manifest.webmanifest", "services/api/src/agentApi.ts", "docs/readme/banner.html"];

/** The old sentence, in the shapes it was written in: a pet's (every pet's) brain or mind as a circuit on X Layer. */
const OLD = [/(brain|mind)s? (is|are) an? (real )?(TapeOut )?circuits? on X Layer/i, /minds are TapeOut circuits on X Layer/i, /its brain the circuit on X Layer/i, /its circuit brain on X Layer/i, /大脑为真实电路的宠物，电路就在 X Layer 上/];

describe("the opening sentence (A86)", () => {
  for (const path of PUBLIC)
    it(`${path} does not say every pet's mind is a circuit on X Layer`, () => {
      const text = read(path);
      for (const old of OLD) expect(text, `${path}: ${old}`).not.toMatch(old);
    });

  it("the landing's first lines say what holds, in both languages", () => {
    for (const old of OLD) expect(`${COPY.en.lede} ${COPY.zh.lede}`).not.toMatch(old);
    expect(COPY.en.lede).toMatch(/NAND gates/);
    expect(COPY.en.lede).toMatch(/keep it on X Layer/i);
    expect(COPY.zh.lede).toMatch(/与非门/);
    expect(COPY.zh.lede).toMatch(/留在 X Layer/);
  });
});
