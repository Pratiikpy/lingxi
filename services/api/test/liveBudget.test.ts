/**
 * P10: each connection kept its pet's whole card (up to CARD_MAX characters), and 4,000 connections could hold 136 MB
 * of cards. The rooms now hold at most CARD_BUDGET of cards together, each network its share of what is free (as the
 * other shelves share theirs), and at most MAX_CONNECTIONS connections. A card the rooms cannot keep is answered as
 * unavailable, which the game says as such; it is never passed off as a damaged card.
 */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { playerIdFor } from "@lingxi/chain";
import { compileProgram, netlistBytes, validateProgram } from "@lingxi/brain";
import { canonicalCard, petCard } from "@lingxi/game";
import { CARD_BUDGET, LiveRooms, MAX_CONNECTIONS } from "../src/live";

const keyOf = (who: string) => createHash("md5").update(who).digest("hex");
const idOf = (who: string) => playerIdFor(keyOf(who));

/** A socket the test drives: what it was sent, its sends finished at once. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<Record<string, unknown>> = [];
  send(data: string, cb?: () => void) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
    cb?.();
  }
  terminate() {
    this.readyState = 3;
    this.emit("close");
  }
  close() {
    this.terminate();
  }
  ping() {}
  say(m: Record<string, unknown>) {
    this.emit("message", Buffer.from(JSON.stringify(m)), false);
  }
}

const CPU = `0x${"c".repeat(40)}`;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const instinct = hex(
  netlistBytes(
    compileProgram(
      validateProgram({
        version: "LX-PET/1",
        memory: [],
        rules: [{ when: { event: [3] }, then: { want: 4, mood: 0 } }],
        otherwise: { want: 0, mood: 1 },
      }),
    ),
  ),
);
/** a card of about 4,000 characters, a different one for each `i` */
const bigCard = (i: number) =>
  petCard({
    lessons: [],
    outside: {
      processor: CPU,
      id: "9",
      owner: `0x${"d".repeat(40)}`,
      parts: [
        { processor: CPU, id: "9", nIn: 16, nOut: 8, hex: instinct },
        { processor: CPU, id: "10", nIn: 16, nOut: 8, hex: i.toString(16).padStart(4_000, "0") },
      ],
    },
  } as never);
const L = (canonicalCard(bigCard(0)) ?? "").length;

let host = 1;
function joinFrom(rooms: LiveRooms, address: string, who: string, card?: string): FakeSocket {
  const ws = new FakeSocket();
  rooms.handle(ws as never, address);
  ws.say({ t: "hello", id: idOf(who), key: keyOf(who), name: who, line: "gentle", stage: "child", space: "room:9" });
  if (card) ws.say({ t: "card", lessons: card });
  return ws;
}
const join = (rooms: LiveRooms, who: string, card?: string) => joinFrom(rooms, `198.51.100.${host++}`, who, card);
/** what `asker` is sent when it asks about `who` */
function ask(asker: FakeSocket, who: string): Record<string, unknown> | undefined {
  asker.sent = [];
  asker.say({ t: "ask", to: idOf(who) });
  return asker.sent.find((m) => m.t === "card" && m.id === idOf(who));
}
const asks = { asksPerConnection: 50, asksPerAddress: 50 };

describe("the rooms hold a bounded budget of cards, shared fairly by network (P10)", () => {
  it("hold at most 1,500 connections and 24 MB of cards", () => {
    expect(MAX_CONNECTIONS).toBe(1_500);
    expect(CARD_BUDGET).toBe(24 * 1024 * 1024);
    expect(L).toBeGreaterThan(4_000);
  });

  it("keep cards up to the budget; one they cannot keep is answered as unavailable, never damaged, until room frees", () => {
    const rooms = new LiveRooms(undefined, undefined, { cardBudget: Math.floor(3.5 * L), cardShare: 1, ...asks });
    const sharers = [0, 1, 2, 3].map((i) => join(rooms, `sharer${i}`, bigCard(i)));
    const viewer = join(rooms, "viewer");
    for (const i of [0, 1, 2]) expect(ask(viewer, `sharer${i}`)?.lessons).toBe(canonicalCard(bigCard(i)));
    const none = ask(viewer, "sharer3");
    expect(none?.unavailable).toBe(true);
    expect(none?.lessons).toBeUndefined();
    expect(JSON.stringify(none)).not.toMatch(/damaged/);
    // asked again, it is still said to be unavailable, not answered "unchanged"
    expect(ask(viewer, "sharer3")?.unavailable).toBe(true);
    // one who held a card leaves; the next share of the card is kept, and sent whole
    sharers[0]?.close();
    sharers[3]?.say({ t: "card", lessons: bigCard(3) });
    expect(ask(viewer, "sharer3")?.lessons).toBe(canonicalCard(bigCard(3)));
  });

  it("let one /48 keep only its share however many connections it opens, and leave room for others", () => {
    const rooms = new LiveRooms(undefined, undefined, { cardBudget: 64 * L, ...asks });
    for (let i = 0; i < 6; i++) joinFrom(rooms, `2001:db8:77:${i % 2}::/64`, `net${i}`, bigCard(10 + i));
    joinFrom(rooms, "203.0.113.50", "other", bigCard(30));
    const viewer = join(rooms, "viewer2");
    const kept = [0, 1, 2, 3, 4, 5].filter((i) => typeof ask(viewer, `net${i}`)?.lessons === "string").length;
    // a sixteenth of the free budget, as each shelf shares its room: four of the /48's cards
    expect(kept).toBe(4);
    expect(ask(viewer, "other")?.lessons).toBe(canonicalCard(bigCard(30)));
  });

  it("say in an answer that its card could not be kept, and send no card in its place", () => {
    const rooms = new LiveRooms(undefined, undefined, { cardBudget: Math.floor(1.5 * L), cardShare: 1, ...asks });
    const a = join(rooms, "propA", bigCard(40));
    const b = join(rooms, "propB", bigCard(41));
    a.say({ t: "propose", to: idOf("propB") });
    a.sent = [];
    b.say({ t: "answer", to: idOf("propA"), yes: true });
    const got = a.sent.find((m) => m.t === "answer");
    expect(got?.yes).toBe(true);
    expect(got?.cardUnavailable).toBe(true);
    expect(got?.card).toBeUndefined();
  });
});
