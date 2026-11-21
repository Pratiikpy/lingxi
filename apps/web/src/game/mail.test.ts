// @vitest-environment happy-dom
/**
 * G8: a newcomer's mailbox. Letters sent before the player first opened the game stay in the mailbox, gifts and all,
 * but only the welcome letter counts as unread; a player who had the mailbox before keeps their count.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type Letter, unreadCount } from "./mail";
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
