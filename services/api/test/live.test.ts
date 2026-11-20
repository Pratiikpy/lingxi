import { CARD_MAX } from "@lingxi/game";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { playerIdFor } from "@lingxi/chain";
import { CAPACITY, MAX_NEW_HOMES_PER_DAY, MAX_PER_ADDRESS, LiveRooms, attachLive, validSpace } from "../src/live";

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
/**
 * Resolves once the room has handled everything `from` sent before it was called: one connection's messages are handled
 * in order, so a position `from` sends now reaching `to` (in the same room) proves the rest came first. A marker the
 * rate limit drops costs nothing and is sent again. Waits for the room itself, not for a length of time (A37).
 */
async function handled(from: Peer, to: Peer, x: number): Promise<void> {
  for (let tries = 0; tries < 30; tries++) {
    from.ws.send(JSON.stringify({ t: "pos", x }));
    try {
      for (;;) if ((await to.next("pos", 700)).x === x) return;
    } catch {
      // not seen yet, or refused by the rate limit: send it again
    }
  }
  throw new Error(`the room never handled position ${x}`);
}

/** `attempt` until it succeeds, for something the server does in its own time (A37). */
async function eventually<T>(attempt: () => Promise<T>, tries = 50, gapMs = 100): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
}

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
    await handled(a, b, 31);
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

  it("a card of the game's whole budget, with every lesson a pet can hold, reaches a friend who asks (A26)", async () => {
    const a = await connect();
    const b = await connect();
    hello(a, "cardbig1", "room:32", "Mochi");
    await a.next("room");
    hello(b, "cardbig2", "room:32", "Tofu");
    await b.next("room");
    const rule = { when: { event: [3] }, then: { want: 5, mood: 1 } };
    // fourteen lessons and an instinct whose circuits take most of the budget
    const full = JSON.stringify({ lessons: Array(14).fill(rule), outside: { parts: [{ hex: "0".repeat(29_000) }] } });
    expect(full.length).toBeGreaterThan(29_000);
    expect(full.length).toBeLessThanOrEqual(CARD_MAX);
    a.ws.send(JSON.stringify({ t: "card", lessons: full }));
    await handled(a, b, 47);
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("cardbig1") }));
    expect((await b.next("card")).lessons).toBe(full);
    // a card over the budget is refused: the card kept is the one before it, which the friend already has (A61)
    a.ws.send(JSON.stringify({ t: "card", lessons: JSON.stringify({ lessons: [rule], outside: { parts: [{ hex: "0".repeat(CARD_MAX) }] } }) }));
    await handled(a, b, 53);
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("cardbig1") }));
    expect(await b.next("card")).toMatchObject({ id: idOf("cardbig1"), unchanged: true });
    // and any other message over 12 KB is ignored, as before
    a.ws.send(JSON.stringify({ t: "say", text: "hi", pad: "x".repeat(13_000) }));
    await expect(b.next("say", 300)).rejects.toThrow();
    a.ws.close();
    b.ws.close();
  });

  it("a name with a character that shows as nothing reaches the room with it shown, never as another pet's name (A16)", async () => {
    const mochi = await connect();
    hello(mochi, "mochi01", "room:22", "Mochi");
    await mochi.next("room");
    const lookalike = await connect();
    hello(lookalike, "lookalike01", "room:22", "Mochi\u061c");
    expect(((await mochi.next("joined")).member as { name: string }).name).toBe("Mochi\ufffd");
    mochi.ws.close();
    lookalike.ws.close();
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
    // the place is free once the server has seen the close, in its own time
    open[0] = await eventually(() => connect(undefined, same));
    for (const p of [...open, other]) p.ws.close();
  });

  it("refuses an extra connection with a complete HTTP answer, which a proxy in front can pass on", async () => {
    const same = "203.0.113.78";
    const open: Peer[] = [];
    for (let i = 0; i < MAX_PER_ADDRESS; i++) open.push(await connect(undefined, same));
    const answer = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { origin: "http://ok.test", "cf-connecting-ip": same } });
      ws.on("unexpected-response", (_req, res) => resolve(res));
      ws.on("open", () => reject(new Error("let in")));
    });
    expect(answer.statusCode).toBe(429);
    // a body of known length (none): without it, a proxy waits for the connection to close to know the answer is over
    expect(answer.headers["content-length"]).toBe("0");
    answer.resume();
    for (const p of open) p.ws.close();
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
    // every one of the forty handled (passed or dropped) before counting
    await handled(b, a, 59);
    const got = a.inbox.filter((m) => m.t === "say").length;
    expect(got).toBeGreaterThan(0);
    expect(got).toBeLessThanOrEqual(8);
    a.ws.close();
    b.ws.close();
  });

  it("one address makes only a few new homes a day, so no one fills the server with empty ones", async () => {
    const same = "203.0.113.99";
    const answers: string[] = [];
    for (let i = 0; i < MAX_NEW_HOMES_PER_DAY + 1; i++) {
      const p = await connect(undefined, same);
      hello(p, `builder${i}`, `home:${idOf(`builder${i}`)}`);
      await p.next("room");
      // entering a home first shows what it holds; the answer to the save comes after
      await p.next("decor");
      p.ws.send(JSON.stringify({ t: "decor", key: keyOf(`builder${i}`), placed: [{ id: "fern", x: 20, y: 90 }] }));
      const m = await Promise.race([p.next("decor"), p.next("decorRefused")]);
      answers.push(String(m.t));
      p.ws.close();
    }
    expect(answers.slice(0, MAX_NEW_HOMES_PER_DAY).every((t) => t === "decor")).toBe(true);
    expect(answers.at(-1)).toBe("decorRefused");
  });
});

describe("live rooms send a card once per change, limit asks, and let quiet connections go (A61)", () => {
  it("a second ask for an unchanged card gets the short answer, and a changed card is sent whole again", async () => {
    const a = await connect();
    const b = await connect();
    hello(a, "once001", "room:33", "Mochi");
    await a.next("room");
    hello(b, "once002", "room:33", "Tofu");
    await b.next("room");
    await a.next("joined");
    const first = JSON.stringify([{ when: { event: [3] }, then: { want: 5, mood: 1 } }]);
    a.ws.send(JSON.stringify({ t: "card", lessons: first }));
    await handled(a, b, 33);
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("once001") }));
    expect((await b.next("card")).lessons).toBe(first);
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("once001") }));
    const again = await b.next("card");
    expect(again).toMatchObject({ id: idOf("once001"), unchanged: true });
    expect(again.lessons).toBeUndefined();
    const second = JSON.stringify([{ when: { event: [2] }, then: { want: 4, mood: 2 } }]);
    a.ws.send(JSON.stringify({ t: "card", lessons: second }));
    await handled(a, b, 34);
    b.ws.send(JSON.stringify({ t: "ask", to: idOf("once001") }));
    expect((await b.next("card")).lessons, "a changed card is sent whole").toBe(second);
    for (const p of [a, b]) p.ws.close();
  });

  it("asks past the limit are not answered", async () => {
    const a = await connect();
    const b = await connect();
    hello(a, "lim0001", "room:34", "Mochi");
    await a.next("room");
    hello(b, "lim0002", "room:34", "Tofu");
    await b.next("room");
    await a.next("joined");
    a.ws.send(JSON.stringify({ t: "card", lessons: "[]" }));
    await handled(a, b, 35);
    let answered = 0;
    for (let i = 0; i < 10; i++) {
      b.ws.send(JSON.stringify({ t: "ask", to: idOf("lim0001") }));
      try {
        await b.next("card", 700);
        answered++;
      } catch {
        // not answered
      }
    }
    expect(answered).toBe(6);
    for (const p of [a, b]) p.ws.close();
  });

  it("a connection silent past the idle time is closed with 4001, and one that does not answer pings is dropped", async () => {
    const quiet = new LiveRooms(undefined, undefined, { idleMs: 400, pingMs: 150 });
    const server = createServer();
    attachLive(server, quiet, ["http://ok.test"]);
    await new Promise<void>((r) => server.listen(0, r));
    const at = (server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${at}/live`, { headers: { origin: "http://ok.test", "cf-connecting-ip": "203.0.113.61" } });
    const code = await new Promise<number>((r) => ws.on("close", (c) => r(c)));
    expect(code, "closed as idle").toBe(4001);
    // a socket that stops answering pings (its pong handler removed, as a dead peer would) is dropped before the idle time
    const dead = new WebSocket(`ws://127.0.0.1:${at}/live`, { headers: { origin: "http://ok.test", "cf-connecting-ip": "203.0.113.62" }, autoPong: false } as never);
    const t0 = Date.now();
    const deadCode = await new Promise<number>((r) => dead.on("close", (c) => r(c)));
    expect(deadCode).not.toBe(4001);
    expect(Date.now() - t0, "dropped for not answering, before the idle time").toBeLessThan(400);
    server.close();
  });
});

describe("a pet's proposals stay few and fresh (A64)", () => {
  it("a target keeps at most 16: the oldest is dropped, and a fresh one is still answered", async () => {
    const t = await connect();
    hello(t, "prop000", "room:36", "Mochi");
    await t.next("room");
    const ps = [] as Array<Awaited<ReturnType<typeof connect>>>;
    for (let i = 1; i <= 18; i++) {
      const p = await connect(undefined, `203.0.113.${100 + i}`);
      hello(p, `prop${String(i).padStart(3, "0")}`, "room:36", `P${i}`);
      await p.next("room");
      ps.push(p);
    }
    for (const p of ps) {
      p.ws.send(JSON.stringify({ t: "propose", to: idOf("prop000") }));
      await t.next("proposal");
    }
    // the first proposer's proposal was dropped: an answer to it goes nowhere
    t.ws.send(JSON.stringify({ t: "answer", to: idOf("prop001"), yes: false }));
    await expect(ps[0]!.next("answer", 600)).rejects.toThrow();
    // the newest is answered
    t.ws.send(JSON.stringify({ t: "answer", to: idOf("prop018"), yes: false }));
    expect(await ps[17]!.next("answer")).toMatchObject({ yes: false });
    for (const p of [t, ...ps]) p.ws.close();
  });
});
