import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { playerIdFor } from "@lingxi/chain";
import { CAPACITY, MAX_PER_ADDRESS, LiveRooms, attachLive, validSpace } from "../src/live";

let port = 0;
const rooms = new LiveRooms();
const http = createServer();

beforeAll(async () => {
  attachLive(http, rooms, ["http://ok.test"]);
  await new Promise<void>((r) => http.listen(0, r));
  port = (http.address() as AddressInfo).port;
});
afterAll(() => http.close());

interface Peer {
  ws: WebSocket;
  inbox: Array<Record<string, unknown>>;
  next: (t: string, timeout?: number) => Promise<Record<string, unknown>>;
}

let nextAddress = 1;
/** Each test player comes from its own address unless one is given, as players do behind Cloudflare. */
function connect(origin = "http://ok.test", address = `198.51.100.${nextAddress++}`): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { origin, "cf-connecting-ip": address } });
    const inbox: Array<Record<string, unknown>> = [];
    const waiters: Array<{ t: string; r: (m: Record<string, unknown>) => void }> = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>;
      const w = waiters.findIndex((x) => x.t === m.t);
      if (w >= 0) waiters.splice(w, 1)[0]!.r(m);
      else inbox.push(m);
    });
    const next = (t: string, timeout = 1500) =>
      new Promise<Record<string, unknown>>((res, rej) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) return res(inbox.splice(i, 1)[0]!);
        const w = { t, r: (m: Record<string, unknown>) => (clearTimeout(timer), res(m)) };
        // a waiter that timed out must not swallow a later message
        const timer = setTimeout(() => (waiters.splice(waiters.indexOf(w), 1), rej(new Error(`no ${t}`))), timeout);
        waiters.push(w);
      });
    ws.on("open", () => resolve({ ws, inbox, next }));
    ws.on("error", reject);
  });
}

/** A test player's device secret and the id that belongs to it. */
const keyOf = (who: string) => createHash("md5").update(who).digest("hex");
const idOf = (who: string) => playerIdFor(keyOf(who));
const hello = (p: Peer, who: string, space: string, name = "Mochi") => p.ws.send(JSON.stringify({ t: "hello", id: idOf(who), key: keyOf(who), name, line: "gentle", stage: "child", mood: 2, space }));

describe("live rooms", () => {
  it("only allows known space names", () => {
    expect(validSpace("room:65")).toBe("room:65");
    expect(validSpace("home:abc123def")).toBe("home:abc123def");
    expect(validSpace("room:../../x")).toBeNull();
    expect(validSpace("anything")).toBeNull();
  });

  it("refuses connections from other origins", async () => {
    await expect(connect("http://evil.test")).rejects.toBeTruthy();
  });

  it("pets in the same room see each other arrive, move, wave and leave", async () => {
    const a = await connect();
    const b = await connect();
    hello(a, "aaaaaa1", "room:65", "Mochi");
    const r1 = await a.next("room");
    expect(r1.members).toEqual([]);
    hello(b, "bbbbbb2", "room:65", "Tofu");
    const r2 = await b.next("room");
    expect((r2.members as Array<{ name: string }>)[0]!.name).toBe("Mochi");
    const joined = await a.next("joined");
    expect((joined.member as { name: string }).name).toBe("Tofu");
    b.ws.send(JSON.stringify({ t: "pos", x: 300 }));
    expect((await a.next("pos")).x).toBe(120);
    b.ws.send(JSON.stringify({ t: "emote", kind: "wave", to: idOf("aaaaaa1") }));
    expect((await a.next("emote")).kind).toBe("wave");
    b.ws.send(JSON.stringify({ t: "emote", kind: "explode" }));
    b.ws.send(JSON.stringify({ t: "say", text: "<b>hi</b> friend" }));
    expect((await a.next("say")).text).toBe("bhi/b friend");
    b.ws.send(JSON.stringify({ t: "say", text: "go fuck yourself" }));
    await expect(a.next("say", 400)).rejects.toThrow();
    b.ws.close();
    expect((await a.next("left")).id).toBe(idOf("bbbbbb2"));
    a.ws.close();
  });

  it("rooms never hold more than the capacity; extra pets get a parallel copy", async () => {
    const peers: Peer[] = [];
    for (let i = 0; i < CAPACITY + 2; i++) {
      const p = await connect();
      hello(p, `cap${String(i).padStart(4, "0")}`, "room:49");
      const r = await p.next("room");
      (p as Peer & { space: string }).space = r.space as string;
      peers.push(p);
    }
    const spaces = peers.map((p) => (p as Peer & { space: string }).space);
    expect(spaces.filter((s) => s === "room:49")).toHaveLength(CAPACITY);
    expect(spaces.filter((s) => s === "room:49#1")).toHaveLength(2);
    for (const p of peers) p.ws.close();
  });

  it("shares a pet's lessons only with someone in the same room who asks", async () => {
    const a = await connect();
    const b = await connect();
    const c = await connect();
    hello(a, "carda01", "room:30", "Mochi");
    await a.next("room");
    hello(b, "cardb02", "room:30", "Tofu");
    await b.next("room");
    await a.next("joined");
    hello(c, "cardc03", "room:31", "Far");
    await c.next("room");
    const lessons = JSON.stringify([{ when: { event: [3] }, then: { want: 5, mood: 1 } }]);
    a.ws.send(JSON.stringify({ t: "card", lessons }));
    a.ws.send(JSON.stringify({ t: "card", lessons: "x".repeat(10_500) }));
    await new Promise((r) => setTimeout(r, 100));
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("carda01") }));
    const card = await b.next("card");
    expect(card.lessons).toBe(lessons);
    expect(card.line).toBe("gentle");
    expect((await a.next("asked")).name).toBe("Tofu");
    c.ws.send(JSON.stringify({ t: "ask", to: idOf("carda01") }));
    await expect(c.next("card", 400)).rejects.toThrow();
    for (const p of [a, b, c]) p.ws.close();
  });

  it("a family proposal needs the other owner's yes, and answers cannot be forged", async () => {
    const a = await connect();
    const b = await connect();
    const c = await connect();
    hello(a, "fama001", "room:40", "Mochi");
    await a.next("room");
    hello(b, "famb002", "room:40", "Tofu");
    await b.next("room");
    hello(c, "famc003", "room:40", "Mallory");
    await c.next("room");
    b.ws.send(JSON.stringify({ t: "card", lessons: JSON.stringify({ lessons: [] }) }));
    // an answer nobody asked for goes nowhere
    c.ws.send(JSON.stringify({ t: "answer", to: idOf("fama001"), yes: true }));
    await expect(a.next("answer", 300)).rejects.toThrow();
    a.ws.send(JSON.stringify({ t: "propose", to: idOf("famb002") }));
    const p = await b.next("proposal");
    expect(p.from).toBe(idOf("fama001"));
    b.ws.send(JSON.stringify({ t: "answer", to: idOf("fama001"), yes: true }));
    const ans = await a.next("answer");
    expect(ans.yes).toBe(true);
    expect(ans.card).toBe(JSON.stringify({ lessons: [] }));
    // a proposal can be answered only once
    b.ws.send(JSON.stringify({ t: "answer", to: idOf("fama001"), yes: true }));
    await expect(a.next("answer", 300)).rejects.toThrow();
    for (const x of [a, b, c]) x.ws.close();
  });

  it("an id is only its owner's: someone who saw it in a room cannot take it, and a made-up id is refused", async () => {
    const owner = await connect();
    hello(owner, "realowner", "room:21", "Mochi");
    await owner.next("room");
    const impostor = await connect();
    // the impostor knows the id (every room shows it) but not the secret behind it
    impostor.ws.send(JSON.stringify({ t: "hello", id: idOf("realowner"), key: keyOf("someone else"), name: "Mochi", line: "gentle", stage: "child", mood: 2, space: "room:21" }));
    expect(await impostor.next("refused")).toEqual({ t: "refused", reason: "id" });
    await expect(owner.next("joined", 300)).rejects.toThrow();
    // without a key, or with an id that is not the key's, nobody gets in
    impostor.ws.send(JSON.stringify({ t: "hello", id: idOf("realowner"), name: "Mochi", space: "room:21" }));
    expect((await impostor.next("refused")).reason).toBe("id");
    impostor.ws.send(JSON.stringify({ t: "hello", id: "abcdef123456", key: keyOf("x"), name: "Mochi", space: "room:21" }));
    expect((await impostor.next("refused")).reason).toBe("id");
    // nothing it says reaches the room as the owner
    impostor.ws.send(JSON.stringify({ t: "say", text: "I am Mochi" }));
    await expect(owner.next("say", 300)).rejects.toThrow();
    owner.ws.close();
    impostor.ws.close();
  });

  it("one address holds only a few connections", async () => {
    const same = "203.0.113.77";
    const open: Peer[] = [];
    for (let i = 0; i < MAX_PER_ADDRESS; i++) open.push(await connect(undefined, same));
    // refused with a real 429, so a proxy in front passes it on as one
    await expect(connect(undefined, same)).rejects.toThrow("429");
    // another address is not affected, and a closed connection frees its place
    const other = await connect();
    open[0]!.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    open[0] = await connect(undefined, same);
    for (const p of [...open, other]) p.ws.close();
  });

  it("drops a flood of messages from one client", async () => {
    const a = await connect();
    const b = await connect();
    hello(a, "flooda1", "room:13");
    await a.next("room");
    hello(b, "floodb2", "room:13");
    await b.next("room");
    await a.next("joined");
    for (let i = 0; i < 40; i++) b.ws.send(JSON.stringify({ t: "say", text: `hi ${i}` }));
    await new Promise((r) => setTimeout(r, 300));
    const got = a.inbox.filter((m) => m.t === "say").length;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(8);
    a.ws.close();
    b.ws.close();
  });
});
