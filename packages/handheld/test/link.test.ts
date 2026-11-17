/**
 * The USB link: the game's client (src/link.ts) against the handheld's own C link (core/link.c) in WebAssembly, with
 * a byte pipe for the serial line. Every answer, every refusal, and a whole trip out and home again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BEAT_MS, createPet, newGrowth } from "@lingxi/game";
import { HandheldLink, LinkError, type LinkIo, MAX_LINE } from "../src/link";
import { type Snack, bringHome, tripPacket } from "../src/trip";
import { root, starterBrain } from "./helpers";

interface HH {
  memory: WebAssembly.Memory;
  hh_init(now: number): number;
  hh_tick(now: number, beat: number, present: number): void;
  hh_key(k: number): void;
  hh_ready(): number;
  hh_link_init(): void;
  hh_link_in(): number;
  hh_link_feed(n: number, nowMs: number): void;
  hh_link_wall_beat(nowMs: number): number;
  hh_beat(): number;
  hh_link_reply(): number;
  hh_link_reply_take(): number;
  hh_link_changed(): number;
}

const wasm = readFileSync(`${root}/wasm/lingxi-handheld.wasm`);

/** a handheld on the other end of a serial line; `split` delivers its answers in pieces, as USB does */
const clock = { ms: 0 };
async function device(split = 0): Promise<{ h: HH; io: LinkIo; raw: (text: string) => string }> {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  const h = instance.exports as unknown as HH;
  h.hh_init(0);
  h.hh_link_init();
  const inbox: Uint8Array[] = [];
  const feed = (bytes: Uint8Array) => {
    for (let i = 0; i < bytes.length; i += 60 * 1024) {
      const part = bytes.subarray(i, i + 60 * 1024);
      new Uint8Array(h.memory.buffer).set(part, h.hh_link_in());
      h.hh_link_feed(part.length, clock.ms);
    }
    const n = h.hh_link_reply_take();
    const reply = new Uint8Array(h.memory.buffer, h.hh_link_reply(), n).slice();
    if (!split) inbox.push(reply);
    else for (let i = 0; i < reply.length; i += split) inbox.push(reply.subarray(i, i + split));
  };
  const io: LinkIo = {
    write: async (b) => feed(b),
    read: async () => inbox.shift() ?? new Uint8Array(0),
  };
  const raw = (text: string) => {
    feed(new TextEncoder().encode(text));
    return new TextDecoder().decode(inbox.splice(0).reduce((a, b) => new Uint8Array([...a, ...b]), new Uint8Array(0)));
  };
  return { h, io, raw };
}

const T0 = Date.UTC(2026, 10, 17, 2, 0);
function trip() {
  const tb = starterBrain("gentle");
  const pet = { ...createPet({ name: "Mochi", line: "gentle", now: T0 - 86_400_000, tzOffsetMin: 480, brain: tb.brain }), beat: Math.floor(T0 / BEAT_MS), growth: newGrowth() };
  const snacks: Snack[] = [{ id: "11110", count: 2, effect: { food: 260, joy: 60, diet: "grain" }, name: { en: "Taro Mochi", zh: "芋泥麻薯" } }];
  const packet = tripPacket(pet, tb.trip, snacks, { name: "Mochi", line: "gentle", stage: 2, form: 0, colour: 0, lang: "en", bornBeat: Math.floor((T0 - 86_400_000) / BEAT_MS) });
  return { pet, tb, snacks, packet };
}

describe("the USB link", () => {
  it("says hello with its self-test and whether a pet is aboard", async () => {
    const { io } = await device();
    expect(await new HandheldLink(io).hello()).toEqual({ version: 1, selfTest: true, aboard: false });
  });

  it("takes a pet, lives with it, sends it back, and lets go only when the game says it is home", async () => {
    const { h, io } = await device(7);
    const link = new HandheldLink(io);
    const t = trip();
    await link.put(t.packet);
    expect(h.hh_link_changed()).toBe(1);
    expect((await link.hello()).aboard).toBe(true);
    h.hh_tick(10_000, t.pet.beat + 1, 1);
    h.hh_key(0x66); // f: one snack kind, fed at once
    h.hh_key(0x68); // h
    h.hh_tick(20_000, t.pet.beat + 31, 0);
    h.hh_tick(20_100, t.pet.beat + 32, 1);
    // plugged in again half an hour later: the game tells the time and the pet has lived up to it
    clock.ms = 40_000;
    expect(h.hh_link_wall_beat(clock.ms)).toBe(-1);
    await link.setTime(t.pet.beat + 33);
    expect(h.hh_link_wall_beat(clock.ms + 120_000)).toBe(t.pet.beat + 35);
    expect(h.hh_beat()).toBe(t.pet.beat + 33);
    const back = await link.get();
    const home = bringHome(t.pet, t.tb.brain, t.snacks, back, (t.pet.beat + 34) * BEAT_MS);
    expect(home.ok).toBe(true);
    if (home.ok) expect(home.snacks[0]!.count).toBe(1);
    // asked twice, it sends the same trip: nothing is lost if the first answer never arrived
    expect(await link.get()).toEqual(back);
    expect(h.hh_ready()).toBe(1);
    await link.done();
    expect(h.hh_ready()).toBe(0);
    expect((await link.hello()).aboard).toBe(false);
  });

  it("refuses a second pet, a damaged packet, a packet too big, bad hex, and requests with no pet aboard", async () => {
    const { io, raw } = await device();
    const link = new HandheldLink(io);
    const t = trip();
    const refused = async (p: Promise<unknown>, word: string) => {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(LinkError);
      expect((e as LinkError).word).toBe(word);
    };
    await refused(link.get(), "empty");
    await refused(link.done(), "empty");
    await refused(link.drop(), "empty");
    const bad = t.packet.slice();
    bad[60]! ^= 1;
    await refused(link.put(bad), "damaged");
    await refused(link.put(new Uint8Array(17 * 1024)), "tooBig");
    expect(raw("LXPUT 0g\n")).toBe("LXERR 21 badHex\n");
    expect(raw("LXPUT 0\n")).toBe("LXERR 21 badHex\n");
    expect(raw("LXPUT\n")).toBe("LXERR 21 badHex\n");
    expect(raw("HELLO\n")).toBe("LXERR 20 unknown\n");
    expect(raw("LXPUTTINGTOOLONG 00\n")).toBe("LXERR 20 unknown\n");
    expect(raw("\r\n")).toBe("");
    expect(raw("LXTIME\n")).toBe("LXERR 27 badTime\n");
    expect(raw("LXTIME 12a\n")).toBe("LXERR 27 badTime\n");
    expect(raw("LXTIME 99999999999\n")).toBe("LXERR 27 badTime\n");
    await link.put(t.packet);
    await refused(link.put(t.packet), "busy");
    await link.drop();
    expect((await link.hello()).aboard).toBe(false);
  });

  it("ignores the firmware's own log lines between answers", async () => {
    const { io } = await device();
    const noisy: LinkIo = {
      write: io.write,
      read: (() => {
        let first = true;
        return async () => {
          if (first) {
            first = false;
            return new TextEncoder().encode("boot: self-test passed\n");
          }
          return io.read();
        };
      })(),
    };
    expect((await new HandheldLink(noisy).hello()).selfTest).toBe(true);
  });

  it("stops reading a device that never ends its line", async () => {
    const flood = new TextEncoder().encode("LX".padEnd(64 * 1024, "f"));
    const noisy: LinkIo = { write: async () => {}, read: async () => flood };
    await expect(new HandheldLink(noisy).hello()).rejects.toThrow("too long");
    expect(MAX_LINE).toBeGreaterThan(2 * (32 * 1024 + 1024));
  });
  it("gives up on a handheld that never answers", async () => {
    const silent: LinkIo = { write: async () => {}, read: () => new Promise(() => {}) };
    await expect(new HandheldLink(silent, 50).hello()).rejects.toThrow("did not answer");
  });
});
