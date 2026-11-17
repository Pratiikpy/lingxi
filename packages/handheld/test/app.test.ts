/**
 * The handheld app (wasm/lingxi-handheld.wasm), driven the way a player drives it: keys and time. What it sends
 * back must come home through the game's replay, and a reload in the middle of a trip must lose nothing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Pet, BEAT_MS } from "@lingxi/game";
import { type Snack, type TripScreen, bringHome, petDigest, tripPacket } from "../src/trip";
import { root, starterBrain } from "./helpers";
import { createPet, newGrowth } from "@lingxi/game";

interface HH {
  memory: WebAssembly.Memory;
  hh_in(): number;
  hh_out(): number;
  hh_fb(): number;
  hh_init(now: number): number;
  hh_open(len: number): number;
  hh_resume(p: number, l: number): number;
  hh_tick(now: number, beat: number, present: number): void;
  hh_key(k: number): void;
  hh_draw(): void;
  hh_close(): number;
  hh_release(): void;
  hh_log(): number;
  hh_log_len(): number;
  hh_ready(): number;
  hh_screen(): number;
  hh_beat(): number;
  hh_selftest(): number;
  hh_digest(): void;
}

const wasm = readFileSync(`${root}/wasm/lingxi-handheld.wasm`);
async function handheld(): Promise<HH> {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  return instance.exports as unknown as HH;
}
const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const put = (h: HH, b: Uint8Array, at = 0) => new Uint8Array(h.memory.buffer).set(b, h.hh_in() + at);
const digest = (h: HH) => {
  h.hh_digest();
  return hex(new Uint8Array(h.memory.buffer, h.hh_out(), 32).slice());
};
const key = (h: HH, k: string | number) => h.hh_key(typeof k === "number" ? k : k.charCodeAt(0));

const T0 = Date.UTC(2026, 10, 17, 2, 0);
function setOut(): { pet: Pet; tb: ReturnType<typeof starterBrain>; snacks: Snack[]; packet: Uint8Array } {
  const tb = starterBrain("curious");
  const pet = { ...createPet({ name: "Sora", line: "curious", now: T0 - 86_400_000, tzOffsetMin: 330, brain: tb.brain }), beat: Math.floor(T0 / BEAT_MS), growth: newGrowth() };
  const snacks: Snack[] = [
    { id: "apple", count: 2, effect: { food: 180, joy: 60, diet: "fruit" } },
    { id: "sundae", count: 1, effect: { food: 140, joy: 160, diet: "sweet" } },
  ];
  const screen: TripScreen = { name: "Sora", line: "curious", stage: 1, form: 0, colour: 0, lang: "en", bornBeat: Math.floor((T0 - 86_400_000) / BEAT_MS) };
  return { pet, tb, snacks, packet: tripPacket(pet, tb.trip, snacks, screen) };
}

/** a few minutes of play through the keys, with the handheld put down for a while in the middle */
function play(h: HH, beat0: number) {
  let now = 10_000;
  let beat = beat0;
  const tick = (ms: number, beats: number, present = 1) => {
    now += ms;
    beat += beats;
    h.hh_tick(now, beat, present);
  };
  tick(100, 1);
  key(h, "h");
  key(h, "f");
  key(h, "2"); // the sundae
  tick(500, 1);
  key(h, "c");
  key(h, "f");
  key(h, "1"); // an apple
  key(h, "f");
  key(h, "1"); // the other apple
  key(h, "f"); // nothing left: a note, no care
  tick(60_000, 40, 0); // put down for forty minutes
  tick(100, 1);
  key(h, "p");
  tick(350, 0);
  key(h, " ");
  tick(1000, 1); // the stars are given
  key(h, "l");
  tick(200, 3);
  key(h, "l");
  key(h, "t");
  key(h, "m");
  tick(100, 2);
  return beat;
}

describe("the handheld app", () => {
  it("passes its own self-test against X Layer's hashes and pet #1's mainnet log", async () => {
    const h = await handheld();
    expect(h.hh_init(0)).toBe(1);
    expect(h.hh_selftest()).toBe(0x1ff);
  });

  it("plays a trip from its keys, and the game brings the pet home by replaying it", async () => {
    const h = await handheld();
    h.hh_init(0);
    const s = setOut();
    put(h, s.packet);
    expect(h.hh_open(s.packet.length)).toBe(0);
    const end = play(h, s.pet.beat);
    expect(h.hh_beat()).toBe(end);
    const n = h.hh_close();
    expect(n).toBeGreaterThan(0);
    const back = new Uint8Array(h.memory.buffer, h.hh_out(), n).slice();
    const home = bringHome(s.pet, s.tb.brain, s.snacks, back, (end + 1) * BEAT_MS);
    expect(home.ok).toBe(true);
    if (!home.ok) return;
    expect(petDigest(home.pet, home.words)).toBe(digest(h));
    expect(home.snacks.map((x) => x.count)).toEqual([0, 0]);
    expect(home.pet.counts.feed).toBe(s.pet.counts.feed + 3);
    expect(home.pet.counts.play).toBe(s.pet.counts.play + 1);
    // the handheld keeps the pet until the game says it arrived
    expect(h.hh_ready()).toBe(1);
    h.hh_release();
    expect(h.hh_ready()).toBe(0);
  });

  it("resumes a trip after a reload from its packet and log, to the same bits", async () => {
    const a = await handheld();
    a.hh_init(0);
    const s = setOut();
    put(a, s.packet);
    a.hh_open(s.packet.length);
    play(a, s.pet.beat);
    const log = new Uint8Array(a.memory.buffer, a.hh_log(), a.hh_log_len()).slice();
    const b = await handheld();
    b.hh_init(0);
    put(b, s.packet);
    put(b, log, s.packet.length);
    expect(b.hh_resume(s.packet.length, log.length)).toBe(0);
    expect(digest(b)).toBe(digest(a));
    expect(new Uint8Array(b.memory.buffer, b.hh_log(), b.hh_log_len()).slice()).toEqual(log);
  });

  it("refuses a second pet while one is here, and a damaged packet, and draws every screen", async () => {
    const h = await handheld();
    h.hh_init(0);
    const s = setOut();
    const bad = s.packet.slice();
    bad[40] = bad[40]! ^ 1;
    put(h, bad);
    expect(h.hh_open(bad.length)).toBe(12); // badCheck
    put(h, s.packet);
    expect(h.hh_open(s.packet.length)).toBe(0);
    expect(h.hh_open(s.packet.length)).not.toBe(0);
    for (const k of ["b", "?", "g", "f"]) {
      key(h, k);
      h.hh_draw();
      const fb = new Uint16Array(h.memory.buffer, h.hh_fb(), 240 * 135);
      expect(new Set(fb).size, `screen after ${k}`).toBeGreaterThan(4);
      key(h, 27);
    }
  });
});
