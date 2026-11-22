// @vitest-environment happy-dom
/**
 * G8: a newcomer's mailbox. Letters sent before the player first opened the game stay in the mailbox, gifts and all,
 * but only the welcome letter counts as unread; a player who had the mailbox before keeps their count.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type Letter, lettersFrom, mailUrl, unreadCount } from "./mail";
import { leave, reload, visit } from "./testGame";

const letter = (id: string, at: number, greets = false): Letter => ({ id, at, subject: { en: id, zh: id }, body: { en: id, zh: id }, ...(greets ? { greets } : {}) });
const sent = [letter("welcome", 100, true), letter("garden", 200), letter("outings", 200), letter("seasons", 200), letter("lane", 300)];

describe("unread letters", () => {
  it("a newcomer has one unread letter, the welcome, however much news came before", () => {
    expect(unreadCount({ letters: sent, local: [], read: [], since: 1_000 })).toBe(1);
  });
  it("news sent after the player arrived is unread", () => {
    expect(unreadCount({ letters: [...sent, letter("later", 2_000)], local: [], read: [], since: 1_000 })).toBe(2);
    expect(unreadCount({ letters: [...sent, letter("later", 2_000)], local: [], read: ["welcome", "later"], since: 1_000 })).toBe(0);
  });
  it("a mailbox from before this change (no arrival time) counts every letter as it did", () => {
    expect(unreadCount({ letters: sent, local: [], read: [] })).toBe(5);
  });
  it("the game's own letters count when they arrive", () => {
    expect(unreadCount({ letters: sent, local: [{ ...letter("season-1", 1_500), local: true }], read: [], since: 1_000 })).toBe(2);
  });
});

describe("a newcomer's arrival", () => {
  afterEach(() => leave());
  it("is kept the first time the mailbox loads, and a later visit keeps the same one", async () => {
    const answer = async () => new Response(JSON.stringify({ ok: true, letters: sent }));
    const { storage } = await visit({ at: 5_000, net: answer });
    const first = (await import("./mail")).useMail;
    expect(first.getState().since).toBe(5_000);
    await first.getState().fetch();
    expect(JSON.parse(storage.getItem("lingxi.mail.v1")!).since).toBe(5_000);
    expect(unreadCount(first.getState())).toBe(1);
    // a day later the page opens again: the same arrival, so news sent in between is unread
    await reload(storage, { at: 90_000_000, net: async () => new Response(JSON.stringify({ ok: true, letters: [...sent, letter("news", 50_000_000)] })) });
    const again = (await import("./mail")).useMail;
    expect(again.getState().since).toBe(5_000);
    await again.getState().fetch();
    expect(unreadCount(again.getState())).toBe(2);
  });
});

describe("the on-chain copy's mailbox, with no server (H11)", () => {
  const day = 86_400_000;
  const now = 1_800_000_000_000;
  const file = [
    { id: "welcome", at: now - 30 * day, subject: { en: "Welcome", zh: "欢迎" }, body: { en: "Hi", zh: "你好" }, gift: { item: 11130, n: 2 }, greets: true },
    { id: "seasons", at: now - 20 * day, subject: { en: "Seasons", zh: "赛季" }, body: { en: "Spar", zh: "切磋" }, needsServer: true },
    { id: "later", at: now + day, subject: { en: "Soon", zh: "很快" }, body: { en: "Soon", zh: "很快" } },
    { id: "over", at: now - 10 * day, until: now - day, subject: { en: "Over", zh: "结束" }, body: { en: "Over", zh: "结束" } },
    { id: "garden", at: now - 5 * day, subject: { en: "Garden", zh: "花园" }, body: { en: "Plots", zh: "地块" }, gift: { item: 7102, n: 2 } },
    { id: "Bad id!", at: now - day, subject: { en: "x", zh: "x" }, body: { en: "x", zh: "x" } },
    "junk",
  ];

  it("reads the letters shipped beside the page, not a server", () => {
    expect(mailUrl("")).toBe("./mail.json");
    expect(mailUrl("https://lingxi.knole.me")).toBe("https://lingxi.knole.me/api/mail");
  });

  it("keeps the letters current now, newest first, and leaves out those about what only the website's server offers", () => {
    const got = lettersFrom(file, now, false);
    expect(got.map((l) => l.id)).toEqual(["garden", "welcome"]);
    expect(got[1]!.gift).toEqual({ item: 11130, n: 2 });
    expect(got[1]!.greets).toBe(true);
  });

  it("takes the server's answer as it is, and nothing from a broken one", () => {
    expect(lettersFrom({ ok: true, letters: [file[0]] }, now, true).map((l) => l.id)).toEqual(["welcome"]);
    expect(lettersFrom({ ok: false }, now, true)).toEqual([]);
    expect(lettersFrom("<html>", now, false)).toEqual([]);
  });
});
