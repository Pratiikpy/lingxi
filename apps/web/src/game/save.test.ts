import { describe, expect, it } from "vitest";
import { COPY_EVERY_MS, type SaveEvent, createSaveStore, isGameKey } from "./save";
import { memoryStorage } from "./testStorage";

const setup = (o: { writer?: boolean; limit?: number } = {}) => {
  const storage = memoryStorage(o.limit);
  const events: SaveEvent[] = [];
  let t = 1_000_000;
  let writer = o.writer ?? true;
  const save = createSaveStore({ storage, now: () => t, isWriter: () => writer, onEvent: (e) => events.push(e) });
  return { storage, events, save, later: (ms: number) => (t += ms), setWriter: (w: boolean) => (writer = w) };
};

describe("the save module", () => {
  it("tells game state from preferences", () => {
    expect(isGameKey("lingxi.pets.v2")).toBe(true);
    expect(isGameKey("lingxi.device.v1")).toBe(true);
    expect(isGameKey("lingxi.lang")).toBe(false);
    expect(isGameKey("lingxi.sound")).toBe(false);
    expect(isGameKey("lingxi.pets.v2~copy")).toBe(false);
    expect(isGameKey("other.key")).toBe(false);
    // the handheld's mailboxes are handed between two tabs by design
    expect(isGameKey("lingxi.handheld.return.v1")).toBe(false);
    expect(isGameKey("lingxi.handheld.trip.v1")).toBe(true);
  });

  it("writes nothing of the game's from a tab that is not the writer, but lets it change preferences", () => {
    const { storage, events, save } = setup({ writer: false });
    expect(save.write("lingxi.world.v1", "{}")).toBe(false);
    expect(storage.getItem("lingxi.world.v1")).toBeNull();
    expect(events).toEqual([{ kind: "refused", key: "lingxi.world.v1" }]);
    expect(save.write("lingxi.lang", "zh")).toBe(true);
    expect(save.remove("lingxi.world.v1")).toBe(false);
  });

  it("keeps a copy of what it replaces: on the first change, then at most every few minutes", () => {
    const { storage, save, later } = setup();
    storage.setItem("lingxi.world.v1", '{"coins":1}');
    save.write("lingxi.world.v1", '{"coins":2}');
    expect(storage.getItem("lingxi.world.v1~copy")).toBe('{"coins":1}');
    save.write("lingxi.world.v1", '{"coins":3}');
    // a minute later the copy still holds the value from before this visit's first change
    expect(storage.getItem("lingxi.world.v1~copy")).toBe('{"coins":1}');
    later(COPY_EVERY_MS + 1);
    save.write("lingxi.world.v1", '{"coins":4}');
    expect(storage.getItem("lingxi.world.v1~copy")).toBe('{"coins":3}');
  });

  it("never makes a copy of something that does not parse, so the copy is always a good one", () => {
    const { storage, save } = setup();
    storage.setItem("lingxi.world.v1~copy", '{"coins":1}');
    storage.setItem("lingxi.world.v1", '{"coins":');
    save.write("lingxi.world.v1", '{"coins":5}');
    expect(storage.getItem("lingxi.world.v1~copy")).toBe('{"coins":1}');
  });

  it("keeps a save that will not parse as it was, offers the last good copy, and refuses to write over it until the player chooses", () => {
    const { storage, events, save } = setup();
    storage.setItem("lingxi.pets.v2", '{"active":0,"pets":[{"na');
    storage.setItem("lingxi.pets.v2~copy", '{"active":0,"pets":[]}');
    expect(save.check()).toEqual([{ key: "lingxi.pets.v2", why: "unreadable" }]);
    expect(storage.getItem("lingxi.pets.v2~damaged")).toBe('{"active":0,"pets":[{"na');
    expect(events).toContainEqual({ kind: "damaged", key: "lingxi.pets.v2", why: "unreadable" });
    expect(save.write("lingxi.pets.v2", "{}")).toBe(false);
    expect(storage.getItem("lingxi.pets.v2")).toBe('{"active":0,"pets":[{"na');
    // the player chose the copy: it is put back, the damaged one stays aside to be downloaded
    expect(save.useCopy("lingxi.pets.v2")).toBe(true);
    expect(storage.getItem("lingxi.pets.v2")).toBe('{"active":0,"pets":[]}');
    expect(storage.getItem("lingxi.pets.v2~damaged")).not.toBeNull();
    expect(save.write("lingxi.pets.v2", '{"active":0,"pets":[]}')).toBe(true);
  });

  it("finds every damaged game save at start, and leaves plain text and preferences alone", () => {
    const { storage, save } = setup();
    storage.setItem("lingxi.world.v1", "{oops");
    storage.setItem("lingxi.player.v1", "0123456789abcdef");
    storage.setItem("lingxi.lang", "zh");
    storage.setItem("lingxi.friends.v1", "[1,2");
    expect(save.check().map((h) => h.key).sort()).toEqual(["lingxi.friends.v1", "lingxi.world.v1"]);
  });

  it("holds a save that parses but this build cannot read: a newer version, or a shape it does not know", () => {
    const { storage, events, save } = setup();
    const readers = {
      "lingxi.world.v1": (v: unknown) => ((v as { version?: number }).version === 1 ? "ok" : (v as { version?: number }).version! > 1 ? "newer" : "unreadable"),
      "lingxi.pets.v2": (v: unknown) => (Array.isArray((v as { pets?: unknown }).pets) ? "ok" : "unreadable"),
      "lingxi.daily.v1": () => "ok" as const,
    } as const;
    storage.setItem("lingxi.world.v1", '{"version":2,"coins":40}');
    storage.setItem("lingxi.pets.v2", '{"active":0,"roster":[]}');
    storage.setItem("lingxi.daily.v1", "fed");
    storage.setItem("lingxi.friends.v1", '{"a":1}');
    const held = save.check(readers);
    expect(held.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "lingxi.daily.v1", why: "unreadable" },
      { key: "lingxi.pets.v2", why: "unreadable" },
      { key: "lingxi.world.v1", why: "newer" },
    ]);
    expect(events).toContainEqual({ kind: "damaged", key: "lingxi.world.v1", why: "newer" });
    // nothing writes over a held save, and it stays exactly as it was
    expect(save.write("lingxi.world.v1", '{"version":1,"coins":0}')).toBe(false);
    expect(storage.getItem("lingxi.world.v1")).toBe('{"version":2,"coins":40}');
    expect(save.write("lingxi.friends.v1", '{"a":2}')).toBe(true);
  });

  it("sets aside the latest damaged save, not one from an earlier time", () => {
    const { storage, save } = setup();
    storage.setItem("lingxi.mail.v1~damaged", '{"old":');
    storage.setItem("lingxi.mail.v1", '{"new":');
    save.check();
    expect(storage.getItem("lingxi.mail.v1~damaged")).toBe('{"new":');
  });

  it("starting a part afresh removes only the save, and only from the tab that plays", () => {
    const { storage, save } = setup();
    storage.setItem("lingxi.badges.v1", "{x");
    save.check();
    expect(save.startFresh("lingxi.badges.v1")).toBe(true);
    expect(storage.getItem("lingxi.badges.v1")).toBeNull();
    expect(storage.getItem("lingxi.badges.v1~damaged")).toBe("{x");
    expect(save.write("lingxi.badges.v1", "{}")).toBe(true);
    const follower = createSaveStore({ storage, now: () => 0, isWriter: () => false, onEvent: () => undefined });
    storage.setItem("lingxi.badges.v1", "{y");
    follower.check();
    expect(follower.startFresh("lingxi.badges.v1")).toBe(false);
    expect(storage.getItem("lingxi.badges.v1")).toBe("{y");
  });

  it("says when storage is full instead of losing the save in silence", () => {
    const { events, save } = setup({ limit: 200 });
    expect(save.write("lingxi.world.v1", "x".repeat(100))).toBe(true);
    expect(save.write("lingxi.pets.v2", "y".repeat(150))).toBe(false);
    expect(events).toContainEqual({ kind: "failed", key: "lingxi.pets.v2", reason: "full" });
  });

  it("warns before storage fills", () => {
    const { events, save } = setup();
    save.write("lingxi.world.v1", "z".repeat(10));
    expect(events.some((e) => e.kind === "nearlyFull")).toBe(false);
    const big = createSaveStore({ storage: memoryStorage(), now: () => 0, isWriter: () => true, onEvent: (e) => events.push(e), warnAtChars: 100 });
    big.write("lingxi.world.v1", "z".repeat(120));
    expect(events).toContainEqual(expect.objectContaining({ kind: "nearlyFull" }));
  });
});
