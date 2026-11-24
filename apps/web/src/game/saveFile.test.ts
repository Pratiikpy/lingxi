import { describe, expect, it } from "vitest";
import {
  MIN_PASSPHRASE,
  SAVE_FILE_KIND,
  makePassphrase,
  openSave,
  passphraseProblem,
  saveKeysOf,
  sealSave,
  summarise,
} from "./saveFile";
import { memoryStorage } from "./testStorage";

/** Fewer rounds than a real file keeps the tests quick; a real file uses KDF_ROUNDS. */
const QUICK = { rounds: 100_000 };
const PASS = "kite-river-amber-42";
const contents = (keys: Record<string, string>) => ({ savedAt: 1_795_000_000_000, keys });
const roster = JSON.stringify({
  active: 0,
  pets: [{ version: 1, name: "Kiri", line: "gentle", bornAt: 1, lessons: [] }],
});

describe("the save file (P1 S5)", () => {
  it("opens with the passphrase it was locked with, giving back every key exactly", async () => {
    const keys = {
      "lingxi.pets.v2": roster,
      "lingxi.session.v1": "0x" + "ab".repeat(32),
      "lingxi.lang": "zh",
      "lingxi.world.v1": '{"version":1,"name":"灵犀小屋"}',
    };
    const file = await sealSave(contents(keys), PASS, QUICK);
    const r = await openSave(file, PASS);
    expect(r).toEqual({ ok: true, contents: contents(keys) });
  });

  it("holds nothing readable without the passphrase: no key, no name, no value appears in the file", async () => {
    const secret = "0x" + "cd".repeat(32);
    const file = await sealSave(contents({ "lingxi.session.v1": secret, "lingxi.pets.v2": roster }), PASS, QUICK);
    expect(file).not.toContain(secret);
    expect(file).not.toContain("cdcdcd");
    expect(file).not.toContain("Kiri");
    expect(file).not.toContain("lingxi.session");
    expect(JSON.parse(file).kind).toBe(SAVE_FILE_KIND);
  });

  it("refuses a wrong passphrase, and a file whose header or data was changed", async () => {
    const file = await sealSave(contents({ "lingxi.pets.v2": roster }), PASS, QUICK);
    expect(await openSave(file, "kite-river-amber-43")).toEqual({ ok: false, reason: "locked" });
    const j = JSON.parse(file);
    // lowering the rounds in the header (to make guessing cheaper) breaks the file rather than weakening it
    expect(await openSave(JSON.stringify({ ...j, kdf: { ...j.kdf, rounds: 100_001 } }), PASS)).toEqual({
      ok: false,
      reason: "locked",
    });
    const data = j.data as string;
    const flipped = (data[10] === "A" ? "B" : "A") + "";
    expect(await openSave(JSON.stringify({ ...j, data: data.slice(0, 10) + flipped + data.slice(11) }), PASS)).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("says plainly when a file is not a save file, or comes from a newer Lingxi", async () => {
    expect(await openSave("hello", PASS)).toEqual({ ok: false, reason: "notASave" });
    expect(await openSave('{"kind":"something-else"}', PASS)).toEqual({ ok: false, reason: "notASave" });
    const j = JSON.parse(await sealSave(contents({ "lingxi.pets.v2": roster }), PASS, QUICK));
    expect(await openSave(JSON.stringify({ ...j, v: 2 }), PASS)).toEqual({ ok: false, reason: "newer" });
    // a header asking for an absurd amount of work is refused before any work is done
    expect(await openSave(JSON.stringify({ ...j, kdf: { ...j.kdf, rounds: 2_000_000_000 } }), PASS)).toEqual({
      ok: false,
      reason: "notASave",
    });
  });

  it("reads the same passphrase however it was typed: surrounding spaces and full-width forms", async () => {
    const file = await sealSave(contents({ "lingxi.pets.v2": roster }), "  灵犀ＡＢＣ一二三四五  ", QUICK);
    expect((await openSave(file, "灵犀ABC一二三四五")).ok).toBe(true);
  });

  it("asks for a passphrase long enough to protect the keys it carries", async () => {
    expect(passphraseProblem("short")).toBe("short");
    expect(passphraseProblem("x".repeat(MIN_PASSPHRASE))).toBeNull();
    expect(passphraseProblem("一二三四五六七八九十")).toBeNull();
    await expect(sealSave(contents({}), "short", QUICK)).rejects.toThrow();
  });

  it("makes strong passphrases: 20 characters of 32 kinds (100 bits), easy to read, never the same", () => {
    const a = makePassphrase();
    const b = makePassphrase();
    expect(a).toMatch(/^[a-km-z2-9]{5}(-[a-km-z2-9]{5}){3}$/);
    expect(a).not.toBe(b);
    expect(passphraseProblem(a)).toBeNull();
  });

  it("takes the whole game from storage, keys included, and leaves out copies, set-aside saves, stamps and a move's backup", () => {
    const s = memoryStorage();
    for (const [k, v] of Object.entries({
      "lingxi.pets.v2": roster,
      "lingxi.session.v1": "0xkey",
      "lingxi.device.v1": "dev",
      "lingxi.lang": "en",
      "lingxi.pets.v2~copy": "{}",
      "lingxi.world.v1~damaged": "{x",
      "lingxi.writer.lease": "{}",
      "lingxi.handheld.lease": "{}",
      "lingxi.before-move.v1": "{}",
      "lingxi.moved.v1": "{}",
      "other.site": "x",
    }))
      s.setItem(k, v);
    expect(Object.keys(saveKeysOf(s)).sort()).toEqual([
      "lingxi.device.v1",
      "lingxi.lang",
      "lingxi.pets.v2",
      "lingxi.session.v1",
    ]);
  });

  it("refuses contents that are not the game's, so a crafted file cannot write elsewhere in storage", async () => {
    const file = await sealSave(
      { savedAt: 1, keys: { "lingxi.pets.v2": roster, "evil.key": "x" } as Record<string, string> },
      PASS,
      QUICK,
    );
    expect(await openSave(file, PASS)).toEqual({ ok: false, reason: "damaged" });
  });

  it("sums a file up before anything is replaced: the pets it holds and when it was saved", () => {
    const s = summarise(
      contents({
        "lingxi.pets.v2": JSON.stringify({
          active: 0,
          pets: [
            { version: 1, name: "Kiri", line: "gentle", bornAt: 1, lessons: [] },
            { version: 9, name: "Nova", line: "gentle", bornAt: 2 },
          ],
        }),
      }),
    );
    expect(s).toEqual({ pets: ["Kiri", "Nova"], savedAt: 1_795_000_000_000, hasKeys: false });
    expect(summarise(contents({ "lingxi.session.v1": "0xkey" })).hasKeys).toBe(true);
  });
});
