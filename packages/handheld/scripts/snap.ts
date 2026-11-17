/**
 * Renders the handheld's own frames (the WebAssembly app, not a mock) for a visual review: every screen, English and
 * Chinese, written as raw RGB565 frames and a JSON index for scripts/snap.py to turn into PNGs.
 *
 *   npx tsx scripts/snap.ts <out dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { STARTERS, compileProgram, fastBrain, netlistBytes } from "@lingxi/brain";
import { BEAT_MS, FOODS, createPet, newGrowth } from "@lingxi/game";
import { tripPacket } from "../src/trip";

const out = process.argv[2] ?? "snaps";
mkdirSync(out, { recursive: true });
const bytes = readFileSync(new URL("../wasm/lingxi-handheld.wasm", import.meta.url));
const shots: Array<{ name: string; file: string }> = [];

async function session(lang: "en" | "zh", script: (h: Handheld) => void) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const h = new Handheld(instance.exports as unknown as HH, lang);
  script(h);
}

interface HH {
  memory: WebAssembly.Memory;
  hh_in(): number;
  hh_fb(): number;
  hh_init(now: number): number;
  hh_open(len: number): number;
  hh_tick(now: number, beat: number, present: number): void;
  hh_key(k: number): void;
  hh_draw(): void;
}

class Handheld {
  now = 1000;
  beat = 0;
  constructor(private x: HH, private lang: "en" | "zh") {
    if (!x.hh_init(this.now)) throw new Error("self-test failed");
  }
  open(lang: "en" | "zh") {
    const n = compileProgram(STARTERS.gentle);
    const t0 = Date.UTC(2026, 10, 17, 9, 30);
    const p = createPet({ name: lang === "zh" ? "团团" : "Mochi", line: "gentle", now: t0 - 2 * 86_400_000, tzOffsetMin: 480, brain: { fast: fastBrain(n), nState: n.latches.length } });
    const pet = { ...p, beat: Math.floor(t0 / BEAT_MS), growth: newGrowth() };
    this.beat = pet.beat;
    const packet = tripPacket(
      pet,
      { processor: "0xf70d324da8c1c4cb0de3ff147e53e7e9db543c4e", id: 1n, bytes: netlistBytes(n), parts: [] },
      FOODS.slice(0, 3).map((f, i) => ({ id: f.id, count: 1 + i, effect: { food: f.food, joy: f.joy, diet: f.diet } })),
      { name: pet.name, line: "gentle", stage: 2, form: 0, colour: 4, lang, bornBeat: Math.floor(p.bornAt / BEAT_MS) },
    );
    new Uint8Array(this.x.memory.buffer).set(packet, this.x.hh_in());
    const e = this.x.hh_open(packet.length);
    if (e !== 0) throw new Error(`open: ${e}`);
  }
  wait(ms: number, beats = 0) {
    this.now += ms;
    this.beat += beats;
    this.x.hh_tick(this.now, this.beat, 1);
  }
  key(k: string | number) {
    this.x.hh_key(typeof k === "number" ? k : k.charCodeAt(0));
  }
  shot(name: string) {
    this.x.hh_draw();
    const fb = new Uint8Array(this.x.memory.buffer, this.x.hh_fb(), 240 * 135 * 2).slice();
    const file = `${out}/${this.lang}-${name}.raw`;
    writeFileSync(file, fb);
    shots.push({ name: `${this.lang}-${name}`, file });
  }
}

for (const lang of ["en", "zh"] as const) {
  await session(lang, (h) => {
    if (lang === "zh") h.key("z");
    h.shot("1-boot");
    h.wait(2000);
    h.shot("2-empty");
    h.open(lang);
    h.wait(100, 1);
    h.shot("3-home");
    h.key("h");
    h.wait(300);
    h.shot("4-petted");
    h.key("f");
    h.wait(200);
    h.shot("5-snacks");
    h.key("2");
    h.wait(300);
    h.shot("6-fed");
    h.wait(7000, 3);
    h.key("p");
    h.wait(350);
    h.shot("7-play");
    h.key(" ");
    h.wait(200);
    h.shot("8-play-stars");
    h.wait(1000, 1);
    h.shot("9-played");
    h.key("b");
    h.wait(100);
    h.shot("10-brain");
    h.key(27);
    h.key("?");
    h.shot("11-help");
    h.key(27);
    h.key("g");
    h.shot("12-leave");
    h.key(27);
    h.key("l");
    h.wait(7000, 2);
    h.shot("13-asleep");
  });
}
writeFileSync(`${out}/index.json`, JSON.stringify(shots));
process.stdout.write(`${shots.length} frames\n`);
