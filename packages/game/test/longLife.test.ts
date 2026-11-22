/**
 * G4: a long life. Visitors who come for what a pet has learned or become, or in a season of the world, each leaving
 * keepsakes on its 3rd and 10th visit; the world's seasons turning every four weeks and coming round again.
 */
import { describe, expect, it } from "vitest";
import { DECOR_BY_ID } from "@lingxi/world";
import { HABIT, PET_SCHOOL, SEASON_DAYS, SEASON_EPOCH, TRAITS, VISITORS, WORLD_SEASONS, keepsakesFrom, nextWorldSeason, schoolIdsOf, visitorComes, visitorHint, visitorOn, worldSeasonAt } from "../src";

const DAY = 86_400_000;
const none = Object.fromEntries(TRAITS.map((t) => [t, 0])) as Record<(typeof TRAITS)[number], number>;
const base = { lessons: [] as string[], traits: none, line: "gentle" as const, stage: "baby" as const };
const names = { trait: (t: string) => t, season: (s: string) => s, stage: (s: string) => s, line: (l: string) => l, form: (f: string) => f };

describe("seasons of the world (G4)", () => {
  it("turn every four weeks through all four and come round again", () => {
    const seen = Array.from({ length: 8 }, (_, i) => worldSeasonAt(SEASON_EPOCH + i * SEASON_DAYS * DAY + DAY).id);
    expect(seen).toEqual([...WORLD_SEASONS.map((s) => s.id), ...WORLD_SEASONS.map((s) => s.id)]);
    const n = nextWorldSeason(SEASON_EPOCH + 3 * DAY);
    expect(n.at).toBe(SEASON_EPOCH + SEASON_DAYS * DAY);
    expect(n.season.id).toBe(WORLD_SEASONS[1]!.id);
  });
});

describe("visitors who come for what a pet is (G4)", () => {
  it("the album holds at least 36, at least 20 of them needing something", () => {
    expect(VISITORS.length).toBeGreaterThanOrEqual(36);
    expect(VISITORS.filter((v) => v.need).length).toBeGreaterThanOrEqual(20);
    expect(new Set(VISITORS.map((v) => v.id)).size).toBe(VISITORS.length);
  });

  it("a visitor with a need comes only when it is met, and every one can be met", () => {
    for (const v of VISITORS.filter((x) => x.need)) {
      const n = v.need!;
      const ms = n.season ? SEASON_EPOCH + WORLD_SEASONS.findIndex((s) => s.id === n.season) * SEASON_DAYS * DAY + DAY : SEASON_EPOCH + DAY;
      const met = {
        ...base,
        lessons: n.lesson ? [n.lesson] : [],
        traits: n.trait ? { ...none, [n.trait]: HABIT } : none,
        line: n.line ?? "gentle",
        stage: n.stage ?? "baby",
        ...(n.form ? { form: n.form } : {}),
      } as Parameters<typeof visitorComes>[1];
      expect(visitorComes(v, met, ms), v.id).toBe(true);
      if (n.lesson || n.trait || n.line || n.stage || n.form) expect(visitorComes(v, { ...base, line: n.line === "bold" ? "curious" : "bold" }, ms), `${v.id} without its need`).toBe(false);
      if (n.season) expect(visitorComes(v, met, ms + SEASON_DAYS * DAY), `${v.id} out of season`).toBe(false);
    }
  });

  it("a pet taught a school lesson draws that lesson's visitor in time", () => {
    const share = PET_SCHOOL.find((s) => s.id === "share")!;
    const ctx = { ...base, lessons: schoolIdsOf([share.rule]) };
    expect(ctx.lessons).toEqual(["share"]);
    const ids = new Set(Array.from({ length: 20_000 }, (_, b) => visitorOn(7, 29_400_000 + b, ctx).id));
    expect(ids.has("tansy")).toBe(true);
    const plain = new Set(Array.from({ length: 20_000 }, (_, b) => visitorOn(7, 29_400_000 + b, base).id));
    expect(plain.has("tansy")).toBe(false);
  });

  it("keepsakes come on the 3rd and 10th visit, once each, and every home piece among them exists", () => {
    const v = VISITORS.find((x) => x.id === "tansy")!;
    const visits = Array.from({ length: 12 }, () => ({ visitor: v }));
    const kept = keepsakesFrom({}, visits);
    expect(kept.map((k) => k.which)).toEqual(["third", "tenth"]);
    expect(keepsakesFrom({ tansy: { count: 3, first: 0 } }, [{ visitor: v }])).toEqual([]);
    for (const x of VISITORS) for (const g of Object.values(x.keepsakes ?? {})) if (g.kind === "decor") expect(DECOR_BY_ID[g.id], `${x.id}: ${g.id}`).toBeTruthy();
  });

  it("every visitor has a hint in both languages", () => {
    for (const v of VISITORS) for (const lang of ["en", "zh"] as const) expect(visitorHint(v, lang, names).length, v.id).toBeGreaterThan(4);
  });
});

describe("elders mentor (G4)", () => {
  it("an elder passes one of its lessons to its own child; not a younger pet, not a stranger's child", async () => {
    const { createPet, mindBrain, mentorLesson, PET_SCHOOL: school } = await import("../src");
    const T0 = Date.UTC(2026, 10, 23, 9);
    const brain = mindBrain({ line: "gentle", lessons: [] });
    const elder0 = createPet({ name: "Old", line: "gentle", now: T0 - 60 * DAY, tzOffsetMin: 480, brain });
    const share = school.find((s) => s.id === "share")!.rule;
    const elder = { ...elder0, lessons: [share] };
    const parent = (key: string) => ({ name: "P", line: "gentle" as const, lessons: [], key });
    const kid0 = createPet({ name: "Kid", line: "gentle", now: T0 - 3 * DAY, tzOffsetMin: 480, brain });
    const child = { ...kid0, family: { parents: [parent(String(elder.bornAt)), parent("other")] as [ReturnType<typeof parent>, ReturnType<typeof parent>], generation: 1 } };
    const r = mentorLesson(elder, child, 0, T0);
    if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
    expect(r.pet.lessons[0]).toEqual(share);
    expect(mentorLesson(elder, kid0, 0, T0)).toMatchObject({ ok: false, reason: "notChild" });
    expect(mentorLesson({ ...elder, bornAt: T0 - 5 * DAY }, { ...child, family: { ...child.family, parents: [parent(String(T0 - 5 * DAY)), parent("x")] } }, 0, T0)).toMatchObject({ ok: false, reason: "notElder" });
    expect(mentorLesson(elder, r.pet, 0, T0)).toMatchObject({ ok: false, reason: "duplicate" });
  });
});
