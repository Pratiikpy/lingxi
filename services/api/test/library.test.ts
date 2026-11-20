import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { PET_SCHOOL } from "@lingxi/game";
import { cleanAuthor, createLibrary, lessonKey } from "../src/library";
import { withLibrary } from "../src/server";

const share = PET_SCHOOL[0]!.rule;
const other = PET_SCHOOL[1]!.rule;

describe("the lesson library", () => {
  it("treats the same rule written in any order as one lesson", () => {
    const shuffled = { ...share, when: Object.fromEntries(Object.entries(share.when).reverse().map(([k, v]) => [k, [...v].reverse()])), label: "different words" };
    expect(lessonKey(shuffled)).toBe(lessonKey(share));
    expect(lessonKey(other)).not.toBe(lessonKey(share));
  });

  it("credits the first teacher, counts one use per player, and lists the most learned first", () => {
    const lib = createLibrary();
    expect(lib.share(share, "Bao", "ip-a", 1)).toMatchObject({ ok: true, isNew: true });
    expect(lib.share(other, "Mochi", "ip-b", 2)).toMatchObject({ ok: true, isNew: true });
    expect(lib.share(share, "Tofu", "ip-c", 3)).toMatchObject({ ok: true, isNew: false });
    const key = lessonKey(share);
    lib.use(key, "ip-d");
    lib.use(key, "ip-d");
    const list = lib.list();
    expect(list[0]).toMatchObject({ key, by: "Bao", uses: 3 });
    expect(list[1]).toMatchObject({ by: "Mochi", uses: 1 });
  });

  it("refuses rules no pet can hold and names that aren't safe to show", () => {
    const lib = createLibrary();
    expect(lib.share({ when: { nope: [1] }, then: { want: 1, mood: 1 } } as never, "Bao", "ip", 1)).toEqual({ ok: false, reason: "invalid" });
    expect(lib.share(share, "<script>", "ip", 1)).toEqual({ ok: false, reason: "name" });
    expect(cleanAuthor("Bo​b")).toBeNull();
    expect(cleanAuthor("包子")).toBe("包子");
  });

  it("hides a lesson after five different players report it (A120)", () => {
    const lib = createLibrary();
    lib.share(share, "Bao", "ip-a", 1);
    const key = lessonKey(share);
    lib.report(key, "x");
    lib.report(key, "x");
    for (const who of ["y", "z", "w"]) lib.report(key, who);
    expect(lib.list(), "four players are not enough").toHaveLength(1);
    lib.report(key, "v");
    expect(lib.list()).toHaveLength(0);
  });

  it("one IPv6 /48 is one reporter and one learner however many /64s it uses (A120)", () => {
    const lib = createLibrary();
    lib.share(share, "Bao", "198.51.100.20", 1);
    const key = lessonKey(share);
    for (let i = 1; i <= 60; i++) lib.report(key, `2001:db8:120:${i.toString(16)}::/64`);
    expect(lib.list(), "sixty reports from one /48 count once").toHaveLength(1);
    lib.share(other, "Mei", "198.51.100.21", 2);
    for (let i = 1; i <= 10; i++) lib.use(lessonKey(other), `2001:db8:121:${i.toString(16)}::/64`, 3);
    expect(lib.list().find((e) => e.key === lessonKey(other))!.uses, "the sharer and one /48").toBe(2);
  });

  it("serves it over HTTP with validation", async () => {
    const app = withLibrary(new Hono(), createLibrary());
    const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify(body) });
    expect((await post("/api/lessons/share", { rule: share, by: "Bao" })).status).toBe(200);
    expect((await post("/api/lessons/share", { rule: { when: {}, then: { want: 99, mood: 1 } }, by: "Bao" })).status).toBe(400);
    expect((await post("/api/lessons/use", { key: "nothex" })).status).toBe(400);
    const list = (await (await app.request("/api/lessons")).json()) as { lessons: Array<{ by: string; uses: number }> };
    expect(list.lessons).toEqual([expect.objectContaining({ by: "Bao", uses: 1 })]);
  });

  it("a well-learned lesson needs reports from a third of the players who learned it, not three spoofed ones", () => {
    const lib = createLibrary();
    lib.share(share, "Bao", "ip-0", 1);
    const key = lessonKey(share);
    for (let i = 1; i < 30; i++) lib.use(key, `ip-${i}`);
    // three addresses, as an attacker with three proxies would have
    for (const who of ["evil-1", "evil-2", "evil-3"]) lib.report(key, who);
    expect(lib.list()).toHaveLength(1);
    for (let i = 4; i <= 10; i++) lib.report(key, `evil-${i}`);
    expect(lib.list()).toHaveLength(0);
  });

  it("shows no stranger's words: labels are dropped, and a teacher's name must pass the same word check as rooms", async () => {
    const lib = createLibrary();
    lib.share({ ...share, label: "visit evil.example for free BEM" } as never, "Bao", "ip-a", 1);
    expect(JSON.stringify(lib.list())).not.toContain("evil.example");
    expect(lib.share(other, "去死", "ip-b", 2)).toEqual({ ok: false, reason: "name" });
    expect(lib.share(other, "fuckface", "ip-b", 2)).toEqual({ ok: false, reason: "name" });
  });

  it("keeps its store small however many addresses share and report, and saves it once a burst is over", async () => {
    const { mkdtempSync, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(mkdtempSync(join(tmpdir(), "lib-")), "library.json");
    const lib = createLibrary(file);
    lib.share(share, "Bao", "ip-0", 1);
    const key = lessonKey(share);
    for (let i = 1; i < 20_000; i++) lib.use(key, `ip-${i}`);
    for (let i = 0; i < 300; i++) lib.report(key, `reporter-${i}`);
    await new Promise((r) => setTimeout(r, 2_500));
    expect(statSync(file).size).toBeLessThan(20_000);
    // every learner counted at most once, most of them counted, and the same after a restart
    const [before] = lib.list();
    expect(before!.uses).toBeGreaterThan(10_000);
    expect(before!.uses).toBeLessThanOrEqual(20_000);
    expect(createLibrary(file).list()).toEqual(lib.list());
  });
});

describe("a full library makes room instead of closing (A64)", () => {
  // distinct lessons a pet can hold
  const lessons = (n: number) => {
    const out: Array<typeof share> = [];
    for (let hunger = 0; hunger < 4 && out.length < n; hunger++)
      for (let want = 0; want < 8 && out.length < n; want++)
        for (let mood = 0; mood < 4 && out.length < n; mood++) {
          const rule = { ...share, when: { hunger: [hunger] }, then: { want, mood } } as typeof share;
          if (createLibrary().share(rule, "Bao", "probe", 0).ok) out.push(rule);
        }
    return out;
  };
  const keys = (lib: ReturnType<typeof createLibrary>) => new Set(lib.list(100).map((l) => l.key));

  it("one sharer holds at most so many lessons nobody else learned: past that, their own oldest goes", () => {
    const rules = lessons(4);
    const lib = createLibrary(undefined, { max: 100, perSharer: 3 });
    rules.forEach((r, i) => expect(lib.share(r, "Bao", "ip-a", i)).toMatchObject({ ok: true }));
    expect(lib.size()).toBe(3);
    expect(keys(lib).has(lessonKey(rules[0]!)), "the first went").toBe(false);
  });

  it("a hidden lesson goes first, then the oldest nobody else learned; a lesson others learned stays", () => {
    const rules = lessons(8);
    const lib = createLibrary(undefined, { max: 6, perSharer: 3 });
    for (let i = 0; i < 3; i++) lib.share(rules[i]!, "Bao", "ip-a", i);
    for (let i = 3; i < 6; i++) lib.share(rules[i]!, "Mochi", "ip-b", i);
    // Mochi's first lesson is learned by someone else; one of Bao's is reported away
    lib.use(lessonKey(rules[3]!), "ip-learner");
    for (const r of ["r1", "r2", "r3"]) lib.report(lessonKey(rules[1]!), r);
    expect(lib.share(rules[6]!, "Tofu", "ip-c", 10)).toMatchObject({ ok: true, isNew: true });
    expect(lib.size()).toBe(6);
    expect(lib.share(rules[7]!, "Tofu", "ip-c", 11)).toMatchObject({ ok: true, isNew: true });
    const left = new Set([...Array(8).keys()].filter((i) => lib.has(lessonKey(rules[i]!))));
    expect(left.has(1), "the hidden one went first").toBe(false);
    expect(left.has(0), "then the oldest nobody else learned").toBe(false);
    expect(left.has(3), "the one someone learned stays").toBe(true);
    expect(left.has(6) && left.has(7)).toBe(true);
  });

  it("two addresses cannot close it: with every lesson used by a second address, an honest share still gets in (A79)", () => {
    const rules = lessons(4);
    const lib = createLibrary(undefined, { max: 3, perSharer: 3 });
    // one address shares, a second "learns" each: every lesson has two uses
    for (let i = 0; i < 3; i++) {
      lib.share(rules[i]!, "Bao", "ip-a", i);
      lib.use(lessonKey(rules[i]!), "ip-friend", i);
    }
    // the third is really learned by five players
    for (let k = 0; k < 5; k++) lib.use(lessonKey(rules[2]!), `ip-learner-${k}`, 10 + k);
    expect(lib.share(rules[3]!, "Tofu", "ip-c", 20)).toMatchObject({ ok: true, isNew: true });
    expect(lib.size()).toBe(3);
    expect(lib.has(lessonKey(rules[0]!)), "the least learned and quietest goes").toBe(false);
    expect(lib.has(lessonKey(rules[1]!))).toBe(true);
    expect(lib.has(lessonKey(rules[2]!)), "the lesson five learned stays").toBe(true);
    expect(lib.has(lessonKey(rules[3]!))).toBe(true);
  });
});
