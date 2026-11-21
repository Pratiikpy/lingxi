// @vitest-environment happy-dom
/**
 * B6: a locked arc says what opens it, truly. Where an arc's first quest needs a story quest handed in, the hint names
 * that quest, in both languages; where it needs a room visited or someone met, the hint does not name a quest.
 */
import { describe, expect, it } from "vitest";
import { STORY } from "@lingxi/world";
import { ARC_OPENS } from "./Quests";

describe("what opens each arc (B6)", () => {
  it("each hint names the story quest that really opens its arc", () => {
    for (const [arc, [en, zh]] of Object.entries(ARC_OPENS).map(([a, t]) => [Number(a), t] as const)) {
      const first = STORY.filter((q) => q.arc === arc)[0];
      if (!first) throw new Error(`arc ${arc} has no quests`);
      const opener = first.requires.find((c) => c.type === "QUEST");
      if (opener) {
        const q = STORY.find((x) => x.id === opener.index)!;
        expect(en, `arc ${arc}`).toContain(`“${q.title.en}”`);
        expect(zh, `arc ${arc}`).toContain(`“${q.title.zh}”`);
      } else {
        expect(en, `arc ${arc} is opened by a deed, not a quest`).not.toMatch(/quest/i);
      }
    }
  });
});
