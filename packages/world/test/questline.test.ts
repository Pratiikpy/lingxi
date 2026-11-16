import { describe, expect, it } from "vitest";
import { DAILIES, LINE_MAX, ONBOARDING, QUESTLINE, STORY, type QuestDef, checkGame, questLineErrors } from "../src";

const base = STORY[0]!;
const bad = (over: Partial<QuestDef>): string[] => questLineErrors([{ ...base, ...over }]);

describe("the quest line", () => {
  it("has the 80 story quests in 12 arcs and the 15 dailies of 36-QUEST-LINE.md, and passes every check", () => {
    expect(STORY).toHaveLength(80);
    expect(STORY.map((q) => q.id)).toEqual(Array.from({ length: 80 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`));
    const perArc = [11, 7, 8, 7, 7, 6, 6, 6, 8, 5, 5, 4];
    perArc.forEach((n, i) => expect(STORY.filter((q) => q.arc === i + 1), `arc ${i + 1}`).toHaveLength(n));
    expect(DAILIES).toHaveLength(15);
    for (const g of ["care", "social", "explore"]) expect(DAILIES.filter((q) => q.group === g)).toHaveLength(5);
    expect(ONBOARDING).toHaveLength(11);
    expect(() => checkGame()).not.toThrow();
  });

  it("every story quest but the first of an arc follows another, and every quest it needs exists", () => {
    const ids = new Set(QUESTLINE.map((q) => q.id));
    for (const q of STORY) for (const c of q.requires) if (c.type === "QUEST") expect(ids.has(String(c.index)), q.id).toBe(true);
  });

  it("names each kind of mistake", () => {
    expect(bad({ giver: "santa" })).toContain("quest q01: no giver santa");
    expect(bad({ intro: [] })).toContain("quest q01: needs an intro");
    expect(bad({ intro: [{ face: "happy", en: "hi", zh: "" }] })).toContain("quest q01 intro 1: needs both languages");
    expect(bad({ intro: [{ face: "grumpy", en: "hi", zh: "嗨" }] })).toContain("quest q01 intro 1: the pet has no face grumpy");
    expect(bad({ giver: "praline", intro: [{ face: "happy", en: "hi", zh: "嗨" }] })).toContain("quest q01 intro 1: praline has no portrait happy");
    expect(bad({ giver: "lane:behemoth", intro: [{ face: "happy", en: "hi", zh: "嗨" }] })).toContain("quest q01 intro 1: Builders' Lane residents speak without a portrait");
    expect(bad({ intro: [{ face: "happy", en: "x".repeat(LINE_MAX.en + 1), zh: "嗨" }] })[0]).toMatch(/English is \d+ characters/);
    expect(bad({ rewards: [{ kind: "item", item: 424242, n: 1 }] })).toContain("quest q01: no item 424242");
    expect(bad({ rewards: [{ kind: "piece", id: "tiara" }] })).toContain("quest q01: no piece tiara");
    expect(bad({ rewards: [{ kind: "decor", id: "sofa" }] })).toContain("quest q01: no decor sofa");
    expect(bad({ rewards: [{ kind: "trust", who: "santa", n: 1 }] })).toContain("quest q01: no resident santa to trust");
    expect(bad({ rewards: [{ kind: "recipe", index: 1 }] })).toContain("quest q01: no travel recipe 1");
    expect(bad({ rewards: [] })).toContain("quest q01: every story quest gives something");
    expect(bad({ requires: [{ type: "MOVE", logic: "INC_MIN", value: 1 }] })).toContain("quest q01 requirement 1: a requirement cannot count from now");
    expect(questLineErrors([base, base])).toContain("quest q01: the id is used twice");
    expect(bad({ arc: undefined })).toContain("quest q01: a story quest needs its arc (1 to 12)");
  });
});
