import { describe, expect, it } from "vitest";
import { DAILIES, FIRST_LESSON_QUEST, ITEM, LINE_MAX, ONBOARDING, QUESTLINE, STORY, type QuestDef, checkGame, questLineErrors } from "../src";

const base = STORY[0]!;
const bad = (over: Partial<QuestDef>): string[] => questLineErrors([{ ...base, ...over }]);

describe("the quest line", () => {
  it("has the 80 story quests in 12 arcs, the 15 dailies of 36-QUEST-LINE.md and the residents' 27 requests (G4), and passes every check", () => {
    expect(STORY).toHaveLength(80);
    expect(STORY.map((q) => q.id)).toEqual(Array.from({ length: 80 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`));
    const perArc = [11, 7, 8, 7, 7, 6, 6, 6, 8, 5, 5, 4];
    perArc.forEach((n, i) => expect(STORY.filter((q) => q.arc === i + 1), `arc ${i + 1}`).toHaveLength(n));
    expect(DAILIES).toHaveLength(15 + 27);
    // three requests for each of the nine residents, each given by that resident
    expect(DAILIES.filter((q) => q.group === "request")).toHaveLength(27);
    for (const q of DAILIES.filter((x) => x.group === "request")) expect(q.id.startsWith(`r-${q.giver}-`), q.id).toBe(true);
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

describe("one name for each place, in both languages (G8)", () => {
  it("wherever a quest says Builders' Lane, its Chinese says 建设者小巷", () => {
    const said = QUESTLINE.flatMap((q) => [...q.intro, ...q.outro, ...q.objectives.map((o) => o.text), q.title]);
    const lane = said.filter((l) => l.en.includes("Builders' Lane"));
    expect(lane.length).toBeGreaterThan(5);
    for (const l of lane) expect(l.zh, l.en).toContain("建设者小巷");
    expect(said.filter((l) => l.zh.includes("建设者小路"))).toEqual([]);
  });
});

describe("a quest names the item it asks for by the item's own name (B6)", () => {
  it("every hand-over objective says the item's Chinese and English names", () => {
    for (const q of STORY)
      for (const o of q.objectives) {
        const c = o.cond as { type: string; index?: unknown };
        if (c.type !== "GIVE_TO" || typeof c.index !== "string") continue;
        const it = ITEM[Number(c.index.split(":")[1])];
        if (!it) continue;
        expect(o.text.zh, `${q.id}: ${it.name.zh}`).toContain(it.name.zh);
        expect(o.text.en.toLowerCase(), `${q.id}: ${it.name.en}`).toContain(it.name.en.toLowerCase());
      }
  });
});

describe("the first-lesson quest (B9)", () => {
  it("is the arc 1 quest that asks for a lesson, titled First lesson", () => {
    const q = STORY.find((x) => x.id === FIRST_LESSON_QUEST)!;
    expect(q.title.en).toBe("First lesson");
    expect(q.objectives.map((o) => o.cond.type)).toEqual(["LESSON"]);
  });
});

describe("residents' requests are offered (G4)", () => {
  it("on about half the days the social daily is a resident's request, and every request comes round within four months", async () => {
    const { pickDailies } = await import("../src/story");
    const offered = new Set<string>();
    let requestDays = 0;
    const days = 120;
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.UTC(2026, 10, 23) + d * 86_400_000).toISOString().slice(0, 10);
      const ids = pickDailies(DAILIES, "seed-g4", day);
      expect(ids).toHaveLength(3);
      const r = ids.find((id) => id.startsWith("r-"));
      if (r) {
        requestDays++;
        offered.add(r);
      }
    }
    expect(requestDays / days).toBeGreaterThan(0.35);
    expect(requestDays / days).toBeLessThan(0.65);
    expect(offered.size).toBe(27);
  });
});

describe("no daily sends a player to a lock (D9)", () => {
  it("every daily that needs the map or the bag says so, and a day with them closed offers none of them", async () => {
    const { DAILIES, pickDailies } = await import("../src");
    const needs = (id: string) => DAILIES.find((q) => q.id === id)?.needs ?? [];
    for (const id of ["d-hello", "d-friend", "d-behemoth", "d-diver", "d-walk", "d-rooms"]) expect(needs(id), id).toContain("map");
    expect(needs("d-gift")).toContain("bag");
    for (const q of DAILIES.filter((x) => x.group === "request")) expect(q.needs, q.id).toEqual(["map", "bag"]);
    for (const id of ["d-breakfast", "d-bath", "d-pats", "d-nap", "d-game", "d-look", "d-evening", "d-bring"]) expect(needs(id), id).toEqual([]);
    let offered = 0;
    for (let k = 0; k < 120; k++) {
      const day = new Date(Date.UTC(2026, 10, 1) + k * 86_400_000).toISOString().slice(0, 10);
      const picked = pickDailies(DAILIES, `seed-${k}`, day, ["map", "bag", "spar"]);
      offered += picked.length;
      for (const id of picked) expect(needs(id), `${day} ${id}`).toEqual([]);
      // with everything open, the social slot and the requests come back
      expect(pickDailies(DAILIES, `seed-${k}`, day)).toHaveLength(3);
    }
    expect(offered).toBe(240);
  });
});
