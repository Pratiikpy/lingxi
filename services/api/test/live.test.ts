import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CAPACITY, LiveRooms, attachLive, validSpace } from "../src/live";

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

function connect(origin = "http://ok.test"): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { origin } });
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
        const timer = setTimeout(() => rej(new Error(`no ${t}`)), timeout);
        waiters.push({ t, r: (m) => (clearTimeout(timer), res(m)) });
      });
    ws.on("open", () => resolve({ ws, inbox, next }));
    ws.on("error", reject);
  });
}

const hello = (p: Peer, id: string, space: string, name = "Mochi") => p.ws.send(JSON.stringify({ t: "hello", id, name, line: "gentle", stage: "child", mood: 2, space }));

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
    b.ws.send(JSON.stringify({ t: "emote", kind: "wave", to: "aaaaaa1" }));
    expect((await a.next("emote")).kind).toBe("wave");
    b.ws.send(JSON.stringify({ t: "emote", kind: "explode" }));
    b.ws.send(JSON.stringify({ t: "say", text: "<b>hi</b> friend" }));
    expect((await a.next("say")).text).toBe("bhi/b friend");
    b.ws.send(JSON.stringify({ t: "say", text: "go fuck yourself" }));
    await expect(a.next("say", 400)).rejects.toThrow();
    b.ws.close();
    expect((await a.next("left")).id).toBe("bbbbbb2");
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
    a.ws.send(JSON.stringify({ t: "card", lessons: "x".repeat(4000) }));
    await new Promise((r) => setTimeout(r, 100));
    b.ws.send(JSON.stringify({ t: "ask", to: "carda01" }));
    const card = await b.next("card");
    expect(card.lessons).toBe(lessons);
    expect(card.line).toBe("gentle");
    expect((await a.next("asked")).name).toBe("Tofu");
    c.ws.send(JSON.stringify({ t: "ask", to: "carda01" }));
    await expect(c.next("card", 400)).rejects.toThrow();
    for (const p of [a, b, c]) p.ws.close();
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
