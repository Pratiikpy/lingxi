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

  it("hides a lesson after three different players report it", () => {
    const lib = createLibrary();
    lib.share(share, "Bao", "ip-a", 1);
    const key = lessonKey(share);
    lib.report(key, "x");
    lib.report(key, "x");
    lib.report(key, "y");
    expect(lib.list()).toHaveLength(1);
    lib.report(key, "z");
    expect(lib.list()).toHaveLength(0);
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
});
