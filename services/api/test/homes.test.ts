import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { playerIdFor } from "@lingxi/chain";
import { createDecorStore } from "../src/decor";
import { CACHE_ENTRIES, type HomeChain, MAX_LINKED, createHomes, homeLinkMessage, visible } from "../src/homes";
import { LiveRooms, attachLive } from "../src/live";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const bob = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const HOME = "home1234";

/** A chain where each wallet holds what the test says, and reads can be made to fail. */
function fakeChain() {
  const state = {
    packs: {} as Record<string, number>,
    pieces: {} as Record<string, string[]>,
    owners: {} as Record<string, Address>,
    colours: {} as Record<string, number>,
    down: false,
    reads: 0,
  };
  const guard = () => {
    state.reads++;
    if (state.down) throw new Error("rpc");
  };
  const chain: HomeChain = {
    roomPacks: async (ws) => (guard(), Math.max(0, ...ws.map((w) => state.packs[w] ?? 0))),
    piecesHeld: async (ws) => (guard(), [...new Set(ws.flatMap((w) => state.pieces[w] ?? []))]),
    ownerOf: async (id) => {
      guard();
      const o = state.owners[id.toString()];
      if (!o) throw new Error("ERC721NonexistentToken");
      return o;
    },
    nameColour: async (id) => (guard(), state.colours[id.toString()] ?? 0),
  };
  return { state, chain };
}

describe("linking a wallet to a home (plan 4.9)", () => {
  it("links a wallet that signed this home's message, and only that wallet", async () => {
    const homes = createHomes({ chain: fakeChain().chain });
    const sig = await alice.signMessage({ message: homeLinkMessage(HOME) });
    expect(await homes.link(HOME, alice.address, sig)).toEqual({ ok: true, wallets: [alice.address] });
    // the same wallet twice is one link; the address's letter case does not matter
    expect(await homes.link(HOME, alice.address.toLowerCase(), sig)).toEqual({ ok: true, wallets: [alice.address] });
    // someone else's signature, or a signature for another home, links nothing
    expect(await homes.link(HOME, bob.address, sig)).toEqual({ ok: false, reason: "signature" });
    const forOther = await bob.signMessage({ message: homeLinkMessage("otherhome") });
    expect(await homes.link(HOME, bob.address, forOther)).toEqual({ ok: false, reason: "signature" });
    expect(await homes.link(HOME, bob.address, `0x${"00".repeat(65)}`)).toMatchObject({ ok: false });
    expect(await homes.link(HOME, "0x123", sig)).toEqual({ ok: false, reason: "invalid" });
    expect(await homes.link("bad id!", alice.address, sig)).toEqual({ ok: false, reason: "invalid" });
    expect(homes.wallets(HOME)).toEqual([alice.address]);
  });

  it("holds at most four wallets, and a wallet can be unlinked", async () => {
    const homes = createHomes({ chain: fakeChain().chain });
    for (let i = 0; i < MAX_LINKED; i++) {
      const w = privateKeyToAccount(`0x${(i + 1).toString(16).padStart(64, "0")}`);
      expect((await homes.link(HOME, w.address, await w.signMessage({ message: homeLinkMessage(HOME) }))).ok).toBe(
        true,
      );
    }
    expect(await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }))).toEqual({
      ok: false,
      reason: "full",
    });
    const first = homes.wallets(HOME)[0]!;
    expect(homes.unlink(HOME, first)).toEqual({ ok: true, wallets: homes.wallets(HOME) });
    expect(homes.wallets(HOME)).toHaveLength(MAX_LINKED - 1);
    expect(homes.unlink(HOME, "nope")).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps its links across a restart", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "homes-")), "homes.json");
    const a = createHomes({ file });
    await a.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    await new Promise((r) => setTimeout(r, 2_300));
    expect(createHomes({ file }).wallets(HOME)).toEqual([alice.address]);
  });
});

describe("what visitors see (plan 4.9)", () => {
  const placed = (n: number, chainPieces: string[] = []) => [
    ...chainPieces.map((id) => ({ id, x: 30, y: 80 })),
    ...[
      "fern",
      "lantern",
      "mushroom",
      "flowers",
      "star",
      "heart",
      "bunting",
      "rug",
      "books",
      "crystal",
      "globe",
      "ball",
      "postcard",
      "starmap",
      "photo",
      "portrait",
      "firstaid",
      "pillow",
      "cloud",
      "dreamjar",
    ]
      .slice(0, n)
      .map((id) => ({ id, x: 40, y: 90 })),
  ];

  it("a home with no linked wallet shows its game pieces, up to 12, and no on-chain piece", async () => {
    const homes = createHomes({ chain: fakeChain().chain });
    const view = await homes.view(HOME);
    expect(view).toEqual({ capacity: 12, held: [] });
    expect(visible(placed(16, ["star-lamp"]), view).map((p) => p.id)).toEqual(placed(12).map((p) => p.id));
  });

  it("room packs and on-chain pieces count only while a linked wallet holds them", async () => {
    let t = 0;
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain, now: () => t });
    await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    state.packs[alice.address] = 2;
    state.pieces[alice.address] = ["star-lamp", "fern", "nope"];
    const view = await homes.view(HOME);
    expect(view).toEqual({ capacity: 20, held: ["star-lamp"] });
    expect(visible(placed(19, ["star-lamp", "moon-window"]), view).map((p) => p.id)).toEqual(
      placed(19, ["star-lamp"])
        .slice(0, 20)
        .map((p) => p.id),
    );
    // the wallet sells its lamp: after the short cache the lamp is gone for visitors
    state.pieces[alice.address] = [];
    expect((await homes.view(HOME)).held).toEqual(["star-lamp"]);
    t += 61_000;
    expect((await homes.view(HOME)).held).toEqual([]);
    // a reading above the contract's limit is clamped
    state.packs[alice.address] = 99;
    t += 61_000;
    expect((await homes.view(HOME)).capacity).toBe(24);
  });

  it("when X Layer cannot be read, the last good reading stands; with none, the bare home", async () => {
    let t = 0;
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain, now: () => t });
    await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    state.down = true;
    expect(await homes.view(HOME)).toEqual({ capacity: 12, held: [] });
    state.down = false;
    state.packs[alice.address] = 1;
    state.pieces[alice.address] = ["moon-window"];
    expect(await homes.view(HOME)).toEqual({ capacity: 16, held: ["moon-window"] });
    state.down = true;
    t += 61_000;
    expect(await homes.view(HOME)).toEqual({ capacity: 16, held: ["moon-window"] });
  });

  it("a pet's name colour shows only when a linked wallet owns the pet", async () => {
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain });
    state.owners["7"] = alice.address;
    state.owners["8"] = bob.address;
    state.colours["7"] = 3;
    state.colours["8"] = 5;
    expect(await homes.colourOf(HOME, "7")).toBe(0);
    await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    expect(await homes.colourOf(HOME, "7")).toBe(3);
    // a pet the player does not own keeps a plain name, whatever its colour on chain
    expect(await homes.colourOf(HOME, "8")).toBe(0);
    expect(await homes.colourOf(HOME, "999")).toBe(0);
    for (const bad of ["0", "-1", "abc", 7, null]) expect(await homes.colourOf(HOME, bad)).toBe(0);
  });

  it("a colour changed on chain is read again on request, but no more than once every few seconds", async () => {
    const { state, chain } = fakeChain();
    let t = 1_000_000;
    const homes = createHomes({ chain, now: () => t });
    state.owners["7"] = alice.address;
    state.colours["7"] = 3;
    await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    expect(await homes.colourOf(HOME, "7")).toBe(3);
    state.colours["7"] = 5;
    // an ordinary reading keeps the cached colour for a minute
    t += 10_000;
    expect(await homes.colourOf(HOME, "7")).toBe(3);
    // a fresh reading looks again
    expect(await homes.colourOf(HOME, "7", true)).toBe(5);
    // asked again at once, it does not touch the chain: a client cannot make the server read on every message
    state.colours["7"] = 6;
    const reads = state.reads;
    t += 1_000;
    expect(await homes.colourOf(HOME, "7", true)).toBe(5);
    expect(state.reads).toBe(reads);
    t += 5_000;
    expect(await homes.colourOf(HOME, "7", true)).toBe(6);
  });
});

describe("the live room with linked homes (plan 4.9)", () => {
  const { state, chain } = fakeChain();
  const rooms = new LiveRooms(createDecorStore(), createHomes({ chain, freshMs: 0 }));
  const http = createServer();
  let port = 0;
  beforeAll(async () => {
    attachLive(http, rooms, ["http://ok.test"]);
    await new Promise<void>((r) => http.listen(0, r));
    port = (http.address() as AddressInfo).port;
  });
  afterAll(() => http.close());

  interface Peer {
    ws: WebSocket;
    next: (t: string, timeout?: number) => Promise<Record<string, unknown>>;
  }
  const connect = (): Promise<Peer> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { origin: "http://ok.test" } });
      const inbox: Array<Record<string, unknown>> = [];
      const waiters: Array<{ t: string; r: (m: Record<string, unknown>) => void }> = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString()) as Record<string, unknown>;
        const w = waiters.findIndex((x) => x.t === m.t);
        if (w >= 0) waiters.splice(w, 1)[0]!.r(m);
        else inbox.push(m);
      });
      const next = (t: string, timeout = 2000) =>
        new Promise<Record<string, unknown>>((res, rej) => {
          const i = inbox.findIndex((m) => m.t === t);
          if (i >= 0) return res(inbox.splice(i, 1)[0]!);
          const w = { t, r: (m: Record<string, unknown>) => (clearTimeout(timer), res(m)) };
          const timer = setTimeout(() => (waiters.splice(waiters.indexOf(w), 1), rej(new Error(`no ${t}`))), timeout);
          waiters.push(w);
        });
      ws.on("open", () => resolve({ ws, next }));
      ws.on("error", reject);
    });
  const send = (p: Peer, m: unknown) => p.ws.send(JSON.stringify(m));
  const keyOf = (who: string) => createHash("md5").update(who).digest("hex");
  const idOf = (who: string) => playerIdFor(keyOf(who));
  const OTHER_KEY = "b".repeat(32);

  it("a visitor sees an on-chain piece only after the owner links the wallet that holds it", async () => {
    state.pieces[alice.address] = ["star-lamp"];
    state.packs[alice.address] = 1;
    const owner = await connect();
    send(owner, {
      t: "hello",
      id: idOf("ownerhome1"),
      key: keyOf("ownerhome1"),
      name: "Mochi",
      line: "gentle",
      stage: "child",
      mood: 2,
      space: `home:${idOf("ownerhome1")}`,
    });
    await owner.next("room");
    // entering a home sends its pieces; this one has none yet
    expect((await owner.next("decor")).placed).toEqual([]);
    const many = [
      { id: "star-lamp", x: 30, y: 80 },
      ...[
        "fern",
        "lantern",
        "mushroom",
        "flowers",
        "star",
        "heart",
        "bunting",
        "rug",
        "books",
        "crystal",
        "globe",
        "ball",
        "postcard",
        "starmap",
        "photo",
        "portrait",
      ].map((id) => ({ id, x: 40, y: 90 })),
    ];
    expect(many).toHaveLength(17);
    send(owner, { t: "decor", key: keyOf("ownerhome1"), placed: many });
    const before = await owner.next("decor");
    expect((before.placed as Array<{ id: string }>).map((p) => p.id)).toEqual(many.slice(1, 13).map((p) => p.id));

    // someone holding the home's link but not its key cannot link a wallet to it
    const stranger = await connect();
    send(stranger, {
      t: "hello",
      id: idOf("ownerhome1"),
      key: OTHER_KEY,
      name: "Fake",
      line: "gentle",
      stage: "child",
      mood: 2,
      space: "room:65",
    });
    expect(await stranger.next("refused")).toEqual({ t: "refused", reason: "id" });
    send(stranger, {
      t: "link",
      key: OTHER_KEY,
      wallet: bob.address,
      signature: await bob.signMessage({ message: homeLinkMessage(idOf("ownerhome1")) }),
    });
    await expect(stranger.next("linked", 300)).rejects.toThrow();

    send(owner, {
      t: "link",
      key: keyOf("ownerhome1"),
      wallet: alice.address,
      signature: await alice.signMessage({ message: homeLinkMessage(idOf("ownerhome1")) }),
    });
    expect(await owner.next("linked")).toEqual({ t: "linked", ok: true, wallets: [alice.address] });
    const after = await owner.next("decor");
    expect((after.placed as Array<{ id: string }>).map((p) => p.id)).toEqual(many.slice(0, 16).map((p) => p.id));

    const visitor = await connect();
    send(visitor, {
      t: "hello",
      id: idOf("visitor22"),
      key: keyOf("visitor22"),
      name: "Tofu",
      line: "bold",
      stage: "child",
      mood: 2,
      space: `home:${idOf("ownerhome1")}`,
    });
    await visitor.next("room");
    expect(((await visitor.next("decor")).placed as unknown[]).length).toBe(16);

    send(owner, { t: "links", key: keyOf("ownerhome1") });
    expect((await owner.next("linked")).wallets).toEqual([alice.address]);
    send(owner, { t: "unlink", key: keyOf("ownerhome1"), wallet: alice.address });
    expect(await owner.next("linked")).toEqual({ t: "linked", ok: true, wallets: [] });
    expect(((await visitor.next("decor")).placed as Array<{ id: string }>).map((p) => p.id)).toEqual(
      many.slice(1, 13).map((p) => p.id),
    );
    for (const p of [owner, stranger, visitor]) p.ws.close();
  });

  it("a pet arrives with its name colour when the player's linked wallet owns it", async () => {
    state.owners["41"] = alice.address;
    state.colours["41"] = 6;
    const a = await connect();
    send(a, {
      t: "hello",
      id: idOf("colourful1"),
      key: keyOf("colourful1"),
      name: "Mochi",
      line: "gentle",
      stage: "child",
      mood: 2,
      space: `home:${idOf("colourful1")}`,
    });
    await a.next("room");
    send(a, {
      t: "link",
      key: keyOf("colourful1"),
      wallet: alice.address,
      signature: await alice.signMessage({ message: homeLinkMessage(idOf("colourful1")) }),
    });
    await a.next("linked");
    const b = await connect();
    send(b, {
      t: "hello",
      id: idOf("watcher33"),
      key: keyOf("watcher33"),
      name: "Tofu",
      line: "bold",
      stage: "child",
      mood: 2,
      space: "room:70",
    });
    await b.next("room");
    send(a, {
      t: "hello",
      id: idOf("colourful1"),
      key: keyOf("colourful1"),
      name: "Mochi",
      line: "gentle",
      stage: "child",
      mood: 2,
      space: "room:70",
      petId: "41",
    });
    await b.next("joined");
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("colourful1"), colour: 6 });
    a.ws.close();
    b.ws.close();
  });

  it("a pet already in a room gains its colour when the wallet is linked, and loses it when unlinked", async () => {
    state.owners["52"] = bob.address;
    state.colours["52"] = 4;
    const a = await connect();
    send(a, {
      t: "hello",
      id: idOf("linklater1"),
      key: keyOf("linklater1"),
      name: "Pip",
      line: "gentle",
      stage: "baby",
      mood: 1,
      space: "room:71",
      petId: "52",
    });
    await a.next("room");
    const b = await connect();
    send(b, {
      t: "hello",
      id: idOf("watcher44"),
      key: keyOf("watcher44"),
      name: "Tofu",
      line: "bold",
      stage: "child",
      mood: 2,
      space: "room:71",
    });
    const room = await b.next("room");
    // not linked yet: the pet is in the room with a plain name
    expect(
      (room.members as Array<Record<string, unknown>>).find((m) => m.id === idOf("linklater1"))?.colour,
    ).toBeUndefined();
    send(a, {
      t: "link",
      key: keyOf("linklater1"),
      wallet: bob.address,
      signature: await bob.signMessage({ message: homeLinkMessage(idOf("linklater1")) }),
    });
    await a.next("linked");
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("linklater1"), colour: 4 });
    // someone arriving now sees the colour in the room list itself
    const c = await connect();
    send(c, {
      t: "hello",
      id: idOf("watcher55"),
      key: keyOf("watcher55"),
      name: "Bean",
      line: "curious",
      stage: "child",
      mood: 2,
      space: "room:71",
    });
    expect(
      ((await c.next("room")).members as Array<Record<string, unknown>>).find((m) => m.id === idOf("linklater1"))
        ?.colour,
    ).toBe(4);
    send(a, { t: "unlink", key: keyOf("linklater1"), wallet: bob.address });
    await a.next("linked");
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("linklater1"), colour: 0 });
    expect(await c.next("colour")).toEqual({ t: "colour", id: idOf("linklater1"), colour: 0 });
    for (const p of [a, b, c]) p.ws.close();
  });

  it("a colour changed on chain shows when the player asks the server to look again", async () => {
    state.owners["53"] = alice.address;
    state.colours["53"] = 2;
    const a = await connect();
    send(a, {
      t: "hello",
      id: idOf("recolour01"),
      key: keyOf("recolour01"),
      name: "Pip",
      line: "gentle",
      stage: "baby",
      mood: 1,
      space: `home:${idOf("recolour01")}`,
    });
    await a.next("room");
    send(a, {
      t: "link",
      key: keyOf("recolour01"),
      wallet: alice.address,
      signature: await alice.signMessage({ message: homeLinkMessage(idOf("recolour01")) }),
    });
    await a.next("linked");
    const b = await connect();
    send(b, {
      t: "hello",
      id: idOf("watcher66"),
      key: keyOf("watcher66"),
      name: "Tofu",
      line: "bold",
      stage: "child",
      mood: 2,
      space: "room:72",
    });
    await b.next("room");
    send(a, {
      t: "hello",
      id: idOf("recolour01"),
      key: keyOf("recolour01"),
      name: "Pip",
      line: "gentle",
      stage: "baby",
      mood: 1,
      space: "room:72",
      petId: "53",
    });
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("recolour01"), colour: 2 });
    state.colours["53"] = 7;
    send(a, { t: "recolour" });
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("recolour01"), colour: 7 });
    // back to plain on chain: the room hears 0
    state.colours["53"] = 0;
    send(a, { t: "recolour" });
    expect(await b.next("colour")).toEqual({ t: "colour", id: idOf("recolour01"), colour: 0 });
    // nothing changed: nothing is sent
    send(a, { t: "recolour" });
    await expect(b.next("colour", 500)).rejects.toThrow("no colour");
    a.ws.close();
    b.ws.close();
  });
});

describe("a room's name colours are read sparingly (A52)", () => {
  it("the same pet asked twice at once is read once, and a player is read colours for at most 12 distinct pets an hour", async () => {
    let t = 0;
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain, now: () => t });
    await homes.link(HOME, alice.address, await alice.signMessage({ message: homeLinkMessage(HOME) }));
    for (let i = 1; i <= 20; i++) {
      state.owners[String(i)] = alice.address;
      state.colours[String(i)] = 3;
    }
    const before = state.reads;
    expect(await Promise.all([homes.colourOf(HOME, "1"), homes.colourOf(HOME, "1")])).toEqual([3, 3]);
    expect(state.reads - before, "one ownerOf and one nameColour").toBe(2);
    for (let i = 2; i <= 20; i++) await homes.colourOf(HOME, String(i));
    expect(state.reads - before, "12 pets read, the rest answered from what is known").toBe(24);
    expect(await homes.colourOf(HOME, "20")).toBe(0);
    // an hour later the player may be read again
    t += 3_600_001;
    expect(await homes.colourOf(HOME, "20")).toBe(3);
  });
});

describe("a full set of linked homes lets go of the one seen longest ago (A74)", () => {
  it("a new link succeeds when full, and the home seen longest ago is the one let go", async () => {
    let now = 1_000;
    const homes = createHomes({ chain: fakeChain().chain, maxHomes: 3, now: () => now });
    const sign = (home: string) => alice.signMessage({ message: homeLinkMessage(home) });
    for (const h of ["homeaaaa", "homebbbb", "homecccc"]) {
      expect(await homes.link(h, alice.address, await sign(h))).toMatchObject({ ok: true });
      now += 1_000;
    }
    // the first home's player comes back: it is now the most recently seen
    homes.seen("homeaaaa");
    now += 1_000;
    expect(
      await homes.link("homedddd", alice.address, await sign("homedddd")),
      "a full store makes room",
    ).toMatchObject({ ok: true });
    expect(homes.wallets("homebbbb"), "the home seen longest ago goes").toEqual([]);
    expect(homes.wallets("homeaaaa"), "the one in use stays").toEqual([alice.address]);
    expect(homes.wallets("homecccc")).toEqual([alice.address]);
    expect(homes.wallets("homedddd")).toEqual([alice.address]);
  });

  it("keeps when each home was last seen across a restart, and reads the old file shape", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "homes-")), "homes.json");
    let now = 5_000;
    const homes = createHomes({ chain: fakeChain().chain, maxHomes: 2, file, now: () => now });
    const sign = (home: string) => alice.signMessage({ message: homeLinkMessage(home) });
    await homes.link("homeaaaa", alice.address, await sign("homeaaaa"));
    now += 1_000;
    await homes.link("homebbbb", alice.address, await sign("homebbbb"));
    now += 1_000;
    homes.seen("homeaaaa");
    await new Promise((r) => setTimeout(r, 2_300));
    const again = createHomes({ chain: fakeChain().chain, maxHomes: 2, file, now: () => now + 1_000 });
    await again.link("homecccc", alice.address, await sign("homecccc"));
    expect(again.wallets("homebbbb"), "last seen read back from the file").toEqual([]);
    expect(again.wallets("homeaaaa")).toEqual([alice.address]);
    // the shape kept before A74 (owner -> wallets) is read, each home counting as seen longest ago
    const { writeFileSync } = await import("node:fs");
    const old = join(mkdtempSync(join(tmpdir(), "homes-")), "homes.json");
    writeFileSync(old, JSON.stringify({ homeolddd: [alice.address] }));
    expect(createHomes({ chain: fakeChain().chain, file: old }).wallets("homeolddd")).toEqual([alice.address]);
  }, 20_000);
});

describe("a player in a room keeps their home's links (A74)", () => {
  it("saying hello in a room marks the player's home as seen", async () => {
    const seen: string[] = [];
    const homes = { ...createHomes({ chain: fakeChain().chain }), seen: (owner: string) => seen.push(owner) };
    const rooms = new LiveRooms(createDecorStore(), homes);
    const server = createServer();
    attachLive(server, rooms, ["http://ok.test"]);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const key = createHash("sha256").update("a74-seen").digest("hex").slice(0, 32);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, {
      headers: { origin: "http://ok.test", "cf-connecting-ip": "203.0.113.74" },
    });
    await new Promise((r) => ws.on("open", r));
    ws.send(
      JSON.stringify({
        t: "hello",
        id: playerIdFor(key),
        key,
        name: "Mochi",
        line: "gentle",
        stage: "baby",
        mood: 1,
        space: "room:74",
      }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([playerIdFor(key)]);
    ws.close();
    server.close();
  });
});

describe("home views have a limit per player (A81)", () => {
  it("one player's 21st uncached home view in a minute reads nothing; another player still reads; cached views are free", async () => {
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain, now: () => 1_000 });
    const owners = Array.from({ length: 22 }, (_, i) => `homeview${String(i).padStart(2, "0")}`);
    for (const o of owners)
      await homes.link(o, alice.address, await alice.signMessage({ message: homeLinkMessage(o) }));
    state.reads = 0;
    for (let i = 0; i < 20; i++) await homes.view(owners[i]!, "visitor-a");
    const used = state.reads;
    expect(used, "twenty homes read").toBeGreaterThan(0);
    const bare = await homes.view(owners[20]!, "visitor-a");
    expect(state.reads, "the 21st reads nothing").toBe(used);
    expect(bare.held, "it shows only what needs no chain").toEqual([]);
    await homes.view(owners[0]!, "visitor-a");
    expect(state.reads, "a home already read is free").toBe(used);
    await homes.view(owners[21]!, "visitor-b");
    expect(state.reads, "another player still reads").toBeGreaterThan(used);
  });
});

describe("the home caches hold 5,000 readings each (P10)", () => {
  it("lets the reading kept longest go once full, and reads it from the chain again", async () => {
    expect(CACHE_ENTRIES).toBe(5_000);
    const { state, chain } = fakeChain();
    const homes = createHomes({ chain, cacheEntries: 2 });
    const owners = ["home0001", "home0002", "home0003"];
    for (const o of owners)
      await homes.link(o, alice.address, await alice.signMessage({ message: homeLinkMessage(o) }));
    for (const o of owners) await homes.view(o);
    const reads = state.reads;
    // the two most recent are kept; the first was let go when the third came
    await homes.view("home0003");
    await homes.view("home0002");
    expect(state.reads).toBe(reads);
    await homes.view("home0001");
    expect(state.reads).toBe(reads + 2);
  });
});
