/**
 * A143: a socket that stops reading is closed once too much waits for it, rather than hold everything sent to it in the
 * server's memory until its pong is missed; and no second card is queued behind one still waiting.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { playerIdFor } from "@lingxi/chain";
import { LiveRooms, MAX_BUFFERED } from "../src/live";

const keyOf = (who: string) => createHash("md5").update(who).digest("hex");

/** A socket the test controls: what it was sent, how much waits for it, and whether it was closed. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<Record<string, unknown>> = [];
  callbacks: Array<() => void> = [];
  terminated = false;
  send(data: string, cb?: () => void) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
    if (cb) this.callbacks.push(cb);
  }
  terminate() {
    this.terminated = true;
    this.readyState = 3;
    this.emit("close");
  }
  close() {
    this.terminate();
  }
  ping() {}
}

const idOf = (who: string) => playerIdFor(keyOf(who));
const join = (rooms: LiveRooms, ws: FakeSocket, who: string, address: string) => {
  rooms.handle(ws as never, address);
  ws.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        t: "hello",
        id: idOf(who),
        key: keyOf(who),
        name: who,
        line: "gentle",
        stage: "child",
        mood: 2,
        space: "room:65",
      }),
    ),
    false,
  );
};

describe("live rooms keep no more than a little for a socket that stops reading (A143)", () => {
  it("closes a socket once more than MAX_BUFFERED waits for it, and the room goes on", () => {
    const rooms = new LiveRooms();
    const silent = new FakeSocket();
    const talker = new FakeSocket();
    join(rooms, silent, "silent01", "198.51.100.143");
    join(rooms, talker, "talker01", "198.51.100.144");
    silent.bufferedAmount = MAX_BUFFERED + 1;
    talker.emit("message", Buffer.from(JSON.stringify({ t: "pos", x: 80 })), false);
    expect(silent.terminated, "the silent socket is closed").toBe(true);
    expect(talker.terminated).toBe(false);
  });

  it("sends no second card while one still waits to go out", () => {
    const rooms = new LiveRooms();
    const asker = new FakeSocket();
    const friend = new FakeSocket();
    join(rooms, friend, "friend01", "198.51.100.145");
    join(rooms, asker, "asker001", "198.51.100.146");
    const card = (want: number) => JSON.stringify([{ when: { event: [3] }, then: { want, mood: 1 } }]);
    friend.emit("message", Buffer.from(JSON.stringify({ t: "card", lessons: card(5) })), false);
    const ask = () => asker.emit("message", Buffer.from(JSON.stringify({ t: "ask", to: idOf("friend01") })), false);
    const cards = () => asker.sent.filter((m) => m.t === "card" && m.lessons !== undefined).length;
    ask();
    expect(cards()).toBe(1);
    // the friend's card changes and is asked for again before the first has gone out
    friend.emit("message", Buffer.from(JSON.stringify({ t: "card", lessons: card(4) })), false);
    ask();
    expect(cards(), "nothing queued behind the card still waiting").toBe(1);
    // once it has gone out, the next ask brings the changed card
    for (const cb of asker.callbacks.splice(0)) cb();
    ask();
    expect(cards()).toBe(2);
  });
});
