// @vitest-environment happy-dom
/**
 * H13: pet letters over TapeRelay, the game's side. The relay client is replaced at its module boundary by a small relay
 * that keeps letters in memory, so what the store does with it is checked: an identity made once and kept, a friend's
 * address approved, a letter sealed for its address and kept with where it stands, letters read only by the tab that
 * holds the save, a stranger's letter waiting, and the relay being down said and recovered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leave, visit } from "./testGame";

const FRIEND = "key:0x00000000000000000000000000000000000000f1@relay2.taperelay.com";
const STRANGER = "key:0x00000000000000000000000000000000000000e5@relay4.taperelay.com";
const relay = vi.hoisted(() => ({
  down: false,
  allowed: [] as string[],
  denied: [] as string[],
  sent: [] as Array<{ to: string; message: string }>,
  inbox: [] as Array<{ id: string; read?: boolean; from: string; text: string }>,
  read: [] as string[],
  published: 0,
}));

vi.mock("@taperelay/client", () => {
  const net = () => {
    if (relay.down) throw new TypeError("Failed to fetch");
  };
  const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return {
    newSelfIdentity: ({ host, privateKey = new Uint8Array(32).fill(7) }: { host: string; privateKey?: Uint8Array }) => ({ privateKey, account: `key:0x${hexOf(privateKey).slice(0, 40)}@${host}` }),
    selfAuth: (_k: Uint8Array, host: string) => ({ account: `me@${host}`, sign: async () => "0x", delegationHeader: null }),
    nodeOf: (a: string) => `${a.slice(a.indexOf("@") + 1)}:443`,
    generateKeyPair: () => ({ publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) }),
    publicKeyOf: () => new Uint8Array(32).fill(1),
    hex: hexOf,
    fromHex: (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))),
    publishSelfKey: async () => (net(), relay.published++, { createdAt: 1 }),
    fetchSelfKey: async () => (net(), { key: new Uint8Array(32).fill(3) }),
    makeSelfNotice: (o: { to: string; message: string }) => o,
    signSelfNotice: async (_a: unknown, n: { to: string; message: string }) => ({ id: "ab".repeat(32), body: JSON.stringify(n) }),
    submitSelfNotice: async (_h: unknown, _a: unknown, s: { id: string; body: string }) => {
      net();
      relay.sent.push(JSON.parse(s.body) as { to: string; message: string });
      return { id: s.id, server: "relay1.taperelay.com:443" };
    },
    openSelfNotice: (it: { id: string; from: string; text: string }) => ({ ok: true, id: it.id, from: it.from, to: "me", createdAt: 1_800_000_000, message: new Uint8Array(), text: it.text }),
    updateSenders: async (_h: unknown, _a: unknown, o: { allow?: string[]; deny?: string[] }) => (net(), relay.allowed.push(...(o.allow ?? [])), relay.denied.push(...(o.deny ?? [])), {}),
    listSenders: async () => ({ items: [] }),
    subscribeNotices: () => () => {},
    createClient: () => ({
      inbox: async () => (net(), { items: relay.inbox.filter((x) => !relay.read.includes(x.id)) }),
      markRead: async (_s: string, _a: unknown, ids: string[]) => void relay.read.push(...ids),
      outboxStatus: async () => ({ status: "delivered" }),
    }),
    deliveryStatus: async () => ({ status: "delivered" }),
  };
});

const letterFrom = (player: string, pet: string, text: string) => JSON.stringify({ lx: 1, from: { pet, player }, toPet: "Kiri", text });

beforeEach(() => {
  Object.assign(relay, { down: false, allowed: [], denied: [], sent: [], inbox: [], read: [], published: 0 });
});
afterEach(() => leave());

async function open() {
  await visit({ at: Date.UTC(2026, 10, 22, 9) });
  const { useLetters } = await import("./letters");
  const { useSaveState } = await import("./saveRuntime");
  return { useLetters, useSaveState };
}

describe("pet letters (H13)", () => {
  it("makes one identity, publishes its key once, keeps it, and gives the same address after a reload", async () => {
    const { useLetters } = await open();
    expect(useLetters.getState().saved).toBeNull();
    await useLetters.getState().ensure();
    await useLetters.getState().ensure();
    expect(relay.published).toBe(1);
    const saved = useLetters.getState().saved!;
    expect(saved.account).toMatch(/^key:0x[0-9a-f]{40}@relay[1-5]\.taperelay\.com$/);
    expect(JSON.parse(localStorage.getItem("lingxi.letters.v1")!).account).toBe(saved.account);
  });

  it("makes exactly one identity when several parts of the game ask for it at the same moment", async () => {
    const { useLetters } = await open();
    const [a, b, c] = await Promise.all([useLetters.getState().ensure(), useLetters.getState().ensure(), useLetters.getState().learnFriend("friend01", FRIEND)]);
    expect(relay.published, "one identity published, never two").toBe(1);
    expect(a?.account).toBe(b?.account);
    expect(c).toBeUndefined();
    expect(useLetters.getState().saved!.account).toBe(a!.account);
  });

  it("records a friend's address and approves it on the relay, once", async () => {
    const { useLetters } = await open();
    await useLetters.getState().learnFriend("friend01", FRIEND);
    await useLetters.getState().learnFriend("friend01", FRIEND);
    expect(useLetters.getState().saved!.book).toEqual({ friend01: FRIEND });
    expect(relay.allowed).toEqual([FRIEND]);
    // an address in any other form is never recorded
    await useLetters.getState().learnFriend("friend02", "https://evil.test");
    expect(useLetters.getState().saved!.book.friend02).toBeUndefined();
  });

  it("seals a letter for the friend's address, keeps it, and says it was delivered", async () => {
    // visit() runs the page on fake timers: the delivery check four seconds later is reached by moving the clock on
    const { useLetters } = await open();
    await useLetters.getState().learnFriend("friend01", FRIEND);
    const r = await useLetters.getState().send({ player: "friend01", pet: "Lulu" }, "Kiri", "me000001", "  Hello Lulu  ");
    expect(r).toEqual({ ok: true });
    expect(relay.sent).toHaveLength(1);
    expect(relay.sent[0]!.to).toBe(FRIEND);
    expect(JSON.parse(relay.sent[0]!.message)).toEqual({ lx: 1, from: { pet: "Kiri", player: "me000001" }, toPet: "Lulu", text: "Hello Lulu" });
    expect(useLetters.getState().saved!.kept[0]).toMatchObject({ dir: "out", pet: "Lulu", text: "Hello Lulu", state: "waiting" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useLetters.getState().saved!.kept[0]!.state).toBe("delivered");
    // too long, empty, or to someone with no address: refused before anything is sent
    expect(await useLetters.getState().send({ player: "friend01", pet: "Lulu" }, "Kiri", "me000001", "x".repeat(601))).toEqual({ ok: false, reason: "tooLong" });
    expect(await useLetters.getState().send({ player: "nobody01", pet: "Bun" }, "Kiri", "me000001", "hi")).toEqual({ ok: false, reason: "noAddress" });
    expect(relay.sent).toHaveLength(1);
  });

  it("keeps a friend's letter, holds a stranger's until accepted, and reads only in the tab that holds the save", async () => {
    const { useLetters, useSaveState } = await open();
    await useLetters.getState().learnFriend("friend01", FRIEND);
    relay.inbox.push({ id: "11".repeat(32), from: FRIEND, text: letterFrom("friend01", "Lulu", "Hi Kiri!") });
    relay.inbox.push({ id: "22".repeat(32), from: STRANGER, text: letterFrom("strang01", "Bun", "Can we be friends?") });
    // another tab plays the game: this one leaves the inbox alone (a letter goes only to the first reader)
    useSaveState.setState({ role: "elsewhere" });
    await useLetters.getState().pull();
    expect(relay.read).toEqual([]);
    useSaveState.setState({ role: "writer" });
    await useLetters.getState().pull();
    const s = useLetters.getState().saved!;
    expect(s.kept.map((k) => [k.dir, k.pet, k.text])).toEqual([["in", "Lulu", "Hi Kiri!"]]);
    expect(s.strangers.map((x) => [x.pet, x.text])).toEqual([["Bun", "Can we be friends?"]]);
    expect(relay.read.sort()).toEqual(["11".repeat(32), "22".repeat(32)]);
    // read again: nothing is kept twice
    await useLetters.getState().pull();
    expect(useLetters.getState().saved!.kept).toHaveLength(1);
    await useLetters.getState().accept(STRANGER);
    expect(useLetters.getState().saved!.book.strang01).toBe(STRANGER);
    expect(useLetters.getState().saved!.kept.map((k) => k.pet)).toEqual(["Bun", "Lulu"]);
    expect(relay.allowed).toContain(STRANGER);
  });

  it("says when the relay cannot be reached, keeps the letter as not delivered, and recovers", async () => {
    const { useLetters } = await open();
    await useLetters.getState().learnFriend("friend01", FRIEND);
    relay.down = true;
    expect(await useLetters.getState().send({ player: "friend01", pet: "Lulu" }, "Kiri", "me000001", "Hello")).toEqual({ ok: false, reason: "down" });
    expect(useLetters.getState().trouble).toBe("down");
    expect(useLetters.getState().saved!.kept[0]).toMatchObject({ state: "failed", text: "Hello" });
    relay.down = false;
    await useLetters.getState().retry(useLetters.getState().saved!.kept[0]!.id, "me000001");
    expect(useLetters.getState().trouble).toBeNull();
    expect(useLetters.getState().saved!.kept[0]!.state).toBe("waiting");
    expect(relay.sent).toHaveLength(1);
  });
});

describe("the letters save (H13)", () => {
  it("is read back on a reload as what it is, never held as damaged", async () => {
    const { READERS } = await import("./saveReaders");
    const { useLetters } = await open();
    await useLetters.getState().ensure();
    const kept = JSON.parse(localStorage.getItem("lingxi.letters.v1")!) as unknown;
    expect(READERS["lingxi.letters.v1"]!(kept)).toBe("ok");
    expect(READERS["lingxi.letters.v1"]!({ v: 2 })).toBe("newer");
    expect(READERS["lingxi.letters.v1"]!({ v: 1 })).toBe("unreadable");
  });
});

describe("the letters identity travels in the save file, never to our server (H13)", () => {
  it("restores to the same address on a fresh browser, and is left out of a device move", async () => {
    const { useLetters } = await open();
    await useLetters.getState().ensure();
    const address = useLetters.getState().saved!.account;
    const { saveKeysOf, sealSave, openSave } = await import("./saveFile");
    const keys = saveKeysOf(localStorage as unknown as Parameters<typeof saveKeysOf>[0]);
    expect(Object.keys(keys)).toContain("lingxi.letters.v1");
    const sealed = await sealSave({ keys, savedAt: Date.now() }, "letters travel safely", { rounds: 100_000 });
    expect(sealed, "the key is not readable in the file").not.toContain(address.slice(6, 46));
    const opened = await openSave(sealed, "letters travel safely");
    if (!opened.ok) throw new Error(opened.reason);
    leave();
    // a fresh browser: the save file's keys put back, then the game reads them
    await visit({ at: Date.UTC(2026, 10, 22, 10) });
    for (const [k, v] of Object.entries(opened.contents.keys)) localStorage.setItem(k, v);
    const again = await import("./letters");
    expect(again.useLetters.getState().saved!.account, "the same address after restoring").toBe(address);

    // a device move hands the save to our server: the letters key stays behind
    let sent = "";
    leave();
    await visit({
      at: Date.UTC(2026, 10, 22, 11),
      net: async (url, init) => {
        if (String(url).endsWith("/api/move")) sent = String(init?.body ?? "");
        return new Response(JSON.stringify({ ok: true, code: "a".repeat(22) }), { headers: { "content-type": "application/json" } });
      },
    });
    for (const [k, v] of Object.entries(opened.contents.keys)) localStorage.setItem(k, v);
    const { prepareMove } = await import("./move");
    await prepareMove();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent, "the move carries no letters identity").not.toContain("lingxi.letters.v1");
    expect(sent).not.toContain(address.slice(6, 46));
  });
});
