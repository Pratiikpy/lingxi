import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { ITEM } from "@lingxi/world";
import { currentLetters, loadLetters } from "../src/mail";
import { withMail } from "../src/server";

const shipped = new URL("../mail/letters.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("mail", () => {
  it("the shipped letters all load, in both languages, and every gift is a real item", () => {
    const letters = loadLetters(shipped);
    expect(letters.length).toBeGreaterThanOrEqual(4);
    for (const l of letters) {
      expect(l.subject.zh.length).toBeGreaterThan(0);
      if (l.gift) expect(ITEM[l.gift.item], l.id).toBeTruthy();
    }
  });

  it("the welcome letter greets every newcomer, and says so to the game (G8)", async () => {
    const letters = loadLetters(shipped);
    expect(letters.filter((l) => l.greets).map((l) => l.id)).toEqual(["welcome"]);
    const app = withMail(
      new Hono(),
      () => letters,
      () => Date.now(),
    );
    const served = (await (await app.request("/api/mail")).json()).letters as Array<{ id: string; greets?: boolean }>;
    expect(served.find((l) => l.id === "welcome")?.greets).toBe(true);
  });

  it("bad letters and duplicates are left out; future and expired letters are not served", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mail-"));
    const f = join(dir, "letters.json");
    const ok = { id: "a", at: 100, subject: { en: "A", zh: "甲" }, body: { en: "x", zh: "x" } };
    writeFileSync(
      f,
      JSON.stringify([
        ok,
        { ...ok },
        { id: "BAD ID", at: 1, subject: ok.subject, body: ok.body },
        { ...ok, id: "later", at: 999 },
        { ...ok, id: "gone", until: 150 },
      ]),
    );
    const letters = loadLetters(f);
    expect(letters.map((l) => l.id).sort()).toEqual(["a", "gone", "later"]);
    expect(currentLetters(letters, 200).map((l) => l.id)).toEqual(["a"]);
    const app = withMail(
      new Hono(),
      () => letters,
      () => 200,
    );
    expect((await (await app.request("/api/mail")).json()).letters.map((l: { id: string }) => l.id)).toEqual(["a"]);
    expect(loadLetters(join(dir, "missing.json"))).toEqual([]);
  });
});
