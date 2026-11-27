/**
 * P10: a connection remembers which card version it was sent of each pet it asked about (A61), so an unchanged card is
 * answered short. That record had no bound: one entry for every pet a connection ever asked about or was answered by,
 * kept for as long as it stays connected, so a long-lived connection in a room whose pets come and go grew without end.
 * It now keeps the most recent `cardsKept` pets; asked again about one it let go, it is sent the card whole, as a
 * connection that never asked would be.
 */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { playerIdFor } from "@lingxi/chain";
import { CARDS_KEPT, CAPACITY, LiveRooms } from "../src/live";

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

let address = 1;
function join(rooms: LiveRooms, who: string, card?: string): FakeSocket {
  const ws = new FakeSocket();
  rooms.handle(ws as never, `198.51.100.${address++}`);
  ws.say({ t: "hello", id: idOf(who), key: keyOf(who), name: who, line: "gentle", stage: "child", space: "room:7" });
  if (card) ws.say({ t: "card", lessons: card });
  return ws;
}

const card = JSON.stringify([{ when: { event: [3] }, then: { want: 5, mood: 1 } }]);
/** what `asker` is sent when it asks about `who`: the whole card, or the short answer for an unchanged one */
function ask(asker: FakeSocket, who: string): "whole" | "unchanged" | "none" {
  asker.sent = [];
  asker.say({ t: "ask", to: idOf(who) });
  const got = asker.sent.find((m) => m.t === "card" && m.id === idOf(who));
  return !got ? "none" : got.unchanged === true ? "unchanged" : "whole";
}

describe("a connection remembers the cards of a bounded number of pets (P10)", () => {
  it("keeps a bound under a full room's worth of cards, and above it", () => {
    expect(CARDS_KEPT).toBeGreaterThanOrEqual(2 * CAPACITY);
    expect(CARDS_KEPT).toBeLessThanOrEqual(256);
  });

  it("answers an unchanged card short while it remembers it, and whole once it has let it go", () => {
    const rooms = new LiveRooms(undefined, undefined, { cardsKept: 2, asksPerConnection: 50, asksPerAddress: 50 });
    for (const who of ["peer0001", "peer0002", "peer0003"]) join(rooms, who, card);
    const asker = join(rooms, "asker001");
    expect(ask(asker, "peer0001")).toBe("whole");
    expect(ask(asker, "peer0001")).toBe("unchanged");
    expect(ask(asker, "peer0002")).toBe("whole");
    // a third pet: the one asked about longest ago is let go
    expect(ask(asker, "peer0003")).toBe("whole");
    expect(ask(asker, "peer0001")).toBe("whole");
    // the two most recent are still remembered
    expect(ask(asker, "peer0003")).toBe("unchanged");
  });

  it("holds the same bound for the cards a proposer is sent with a yes", () => {
    const rooms = new LiveRooms(undefined, undefined, { cardsKept: 1, asksPerConnection: 50, asksPerAddress: 50 });
    const proposer = join(rooms, "propose1");
    const a = join(rooms, "answera1", card);
    const b = join(rooms, "answerb1", card);
    /** what the proposer is sent with `from`'s yes: the card whole, or the mark that it is unchanged */
    const yes = (from: FakeSocket): "whole" | "unchanged" | "none" => {
      proposer.say({ t: "propose", to: idOf(from === a ? "answera1" : "answerb1") });
      proposer.sent = [];
      from.say({ t: "answer", to: idOf("propose1"), yes: true });
      const got = proposer.sent.find((m) => m.t === "answer" && m.yes === true);
      return !got ? "none" : got.cardUnchanged === true ? "unchanged" : typeof got.card === "string" ? "whole" : "none";
    };
    expect(yes(a)).toBe("whole");
    expect(yes(a)).toBe("unchanged");
    expect(yes(b)).toBe("whole");
    // one remembered: a's card went when b's came
    expect(yes(a)).toBe("whole");
  });
});
