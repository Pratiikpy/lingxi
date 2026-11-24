/**
 * Lingxi's own music: four short chiptune pieces written for the game and a small
 * WebAudio synth that plays them (pulse lead, triangle bass, soft arpeggio, noise
 * percussion). No recordings are used, so every note is ours.
 *
 *   Sunrise Hut      — home by day (F major, 92 bpm)
 *   Lantern Evening  — evening (D minor, 84 bpm)
 *   Moonlit Pond     — night (C major, 66 bpm, triangle and bells)
 *   Little Spar      — spars (A minor, 138 bpm)
 *
 * A song is bars of eighth notes. In a melody string, a note name plays, "-"
 * holds the previous note and "." is a rest.
 */

import { create } from "zustand";
import { useSound } from "./sound";
import { now } from "./gameClock";

export type SongId = "day" | "evening" | "night" | "spar";

interface Song {
  title: { en: string; zh: string };
  bpm: number;
  /** chord roots and qualities per bar, e.g. "F", "Am", "C7" */
  chords: string[];
  melody: string[];
  lead: "pulse" | "triangle";
  drums: boolean;
}

export const SONGS: Record<SongId, Song> = {
  day: {
    title: { en: "Sunrise Hut", zh: "日出小屋" },
    bpm: 92,
    lead: "pulse",
    drums: true,
    chords: ["F", "Am", "Bb", "C", "F", "Dm", "C7", "F", "Bb", "F", "Gm", "C", "Am", "Dm", "Bb", "C"],
    melody: [
      "A4 - C5 - F5 - E5 C5",
      "E5 - D5 C5 A4 - - .",
      "D5 - F5 - Bb5 - A5 F5",
      "G5 - - - E5 - C5 .",
      "A4 C5 F5 A5 G5 F5 E5 F5",
      "D5 - F5 - A5 - G5 F5",
      "G5 F5 D5 Bb4 C5 D5 E5 G5",
      "F5 - - - . . . .",
      "F5 - D5 - Bb4 - D5 F5",
      "A5 - - G5 F5 - C5 -",
      "Bb4 D5 G5 - F5 D5 Bb4 D5",
      "E5 - G5 - C6 - Bb5 G5",
      "A5 - E5 - C5 - E5 A5",
      "F5 - - E5 D5 - A4 -",
      "Bb4 D5 F5 Bb5 A5 F5 G5 A5",
      "G5 - - - C5 - - .",
    ],
  },
  evening: {
    title: { en: "Lantern Evening", zh: "灯笼黄昏" },
    bpm: 84,
    lead: "pulse",
    drums: true,
    chords: ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "A"],
    melody: [
      "D5 - - F5 E5 - D5 -",
      "F5 - - - D5 - Bb4 -",
      "C5 - F5 - A5 - G5 F5",
      "E5 - - - - - . .",
      "A5 - - G5 F5 - E5 D5",
      "D5 - F5 - Bb5 - A5 -",
      "G5 - F5 - E5 - D5 -",
      "C#5 - E5 - A4 - - .",
    ],
  },
  night: {
    title: { en: "Moonlit Pond", zh: "月下池塘" },
    bpm: 66,
    lead: "triangle",
    drums: false,
    chords: ["Cmaj7", "Am7", "Fmaj7", "G", "C", "Am", "F", "G"],
    melody: [
      "E5 - - - G5 - - -",
      "A5 - - - E5 - - .",
      "F5 - - - C5 - A4 -",
      "G4 - - - - - . .",
      "C5 - E5 - G5 - - -",
      "A4 - C5 - E5 - D5 -",
      "C5 - - - A4 - - -",
      "G4 - - - - - - .",
    ],
  },
  spar: {
    title: { en: "Little Spar", zh: "小小切磋" },
    bpm: 138,
    lead: "pulse",
    drums: true,
    chords: ["Am", "F", "G", "Em", "Am", "F", "G", "E"],
    melody: [
      "A4 C5 E5 A5 G5 E5 C5 E5",
      "F5 - A5 - G5 F5 E5 D5",
      "D5 G5 B5 G5 D5 B4 G4 B4",
      "E5 - - - B4 - E5 -",
      "A5 G5 E5 C5 D5 E5 G5 A5",
      "C6 - A5 F5 C5 F5 A5 C6",
      "B5 - G5 - D5 - B4 -",
      "G#5 - - - E5 - - .",
    ],
  },
};

const NOTE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

/** Frequency of a note name like "Bb4". */
export function freq(name: string): number {
  const m = name.match(/^([A-G][#b]?)(\d)$/);
  if (!m) throw new Error(`bad note ${name}`);
  const midi = 12 * (Number(m[2]) + 1) + NOTE[m[1]!]!;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Chord tones (root, third, fifth, seventh if any) as MIDI-free semitone offsets from the root. */
export function chordTones(chord: string): { root: string; tones: number[] } {
  const m = chord.match(/^([A-G][#b]?)(maj7|m7|m|7)?$/);
  if (!m) throw new Error(`bad chord ${chord}`);
  const q = m[2] ?? "";
  const tones =
    q === "m"
      ? [0, 3, 7]
      : q === "m7"
        ? [0, 3, 7, 10]
        : q === "7"
          ? [0, 4, 7, 10]
          : q === "maj7"
            ? [0, 4, 7, 11]
            : [0, 4, 7];
  return { root: m[1]!, tones };
}

/** Every melody string must have 8 steps and only real notes; checked in tests. */
export function steps(line: string): string[] {
  return line.trim().split(/\s+/);
}

/* ── the synth ────────────────────────────────────────────────────────────── */

let live: AudioContext | null = null;
let ctx: BaseAudioContext | null = null;
let master: GainNode | null = null;
let pulseWave: PeriodicWave | null = null;
let noise: AudioBuffer | null = null;

/** Builds the instruments on a context (live or offline). */
function voices(c: BaseAudioContext, gain: number): void {
  ctx = c;
  master = c.createGain();
  master.gain.value = gain;
  master.connect(c.destination);
  // a 25% pulse, softer than a square
  const n = 32;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
  pulseWave = c.createPeriodicWave(real, imag);
  noise = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function setup(): AudioContext {
  if (live) return live;
  live = new AudioContext();
  voices(live, 0);
  return live;
}

/** Renders a piece offline (for listening outside the game); the live player is untouched. */
export async function renderSong(id: SongId, loops = 2): Promise<AudioBuffer> {
  const song = SONGS[id];
  const seconds = song.melody.length * 4 * (60 / song.bpm) * loops + 1;
  const off = new OfflineAudioContext(1, Math.ceil(seconds * 44100), 44100);
  const saved = [ctx, master, pulseWave, noise] as const;
  voices(off, VOLUME);
  let at = 0.05;
  for (let b = 0; b < song.melody.length * loops; b++) at += scheduleBar(song, b, at);
  [ctx, master, pulseWave, noise] = saved;
  return off.startRendering();
}

function tone(at: number, f: number, dur: number, kind: "pulse" | "triangle" | "sine", vol: number): void {
  const c = ctx!;
  const o = c.createOscillator();
  if (kind === "pulse") o.setPeriodicWave(pulseWave!);
  else o.type = kind;
  o.frequency.setValueAtTime(f, at);
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.35), at + dur * 0.8);
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function hat(at: number, vol: number, len = 0.04, hp = 7000): void {
  const c = ctx!;
  const s = c.createBufferSource();
  s.buffer = noise!;
  const f = c.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(f).connect(g).connect(master!);
  s.start(at);
  s.stop(at + len + 0.01);
}

/** Schedules one bar of a song starting at `at`; returns the bar's length in seconds. */
function scheduleBar(song: Song, bar: number, at: number): number {
  const eighth = 60 / song.bpm / 2;
  const { root, tones } = chordTones(song.chords[bar % song.chords.length]!);
  const rootF = freq(`${root}3`);
  const line = steps(song.melody[bar % song.melody.length]!);
  for (let i = 0; i < 8; i++) {
    const t = at + i * eighth;
    const n = line[i]!;
    if (n !== "-" && n !== ".") {
      let len = 1;
      while (i + len < 8 && line[i + len] === "-") len++;
      tone(t, freq(n), eighth * len * 0.95, song.lead, song.lead === "triangle" ? 0.11 : 0.075);
      if (song.lead === "triangle") tone(t, freq(n) * 2, eighth * len * 0.6, "sine", 0.025); // a bell on top
    }
    // bass: root, fifth, octave, fifth
    const bassStep = [0, 7, 12, 7][Math.floor(i / 2) % 4]!;
    if (i % 2 === 0) tone(t, (rootF / 2) * 2 ** (bassStep / 12), eighth * 1.7, "triangle", 0.14);
    // soft arpeggio on the offbeats
    if (i % 2 === 1) tone(t, rootF * 2 * 2 ** (tones[(i >> 1) % tones.length]! / 12), eighth * 0.9, "sine", 0.035);
    if (song.drums) {
      if (i % 2 === 1) hat(t, 0.035);
      if (i === 0 || i === 4) hat(t, 0.09, 0.09, 120);
    }
  }
  return eighth * 8;
}

/* ── the player ───────────────────────────────────────────────────────────── */

interface MusicState {
  song: SongId | null;
  /** start or switch the piece (silently ignored until sound is on) */
  want: (id: SongId | null) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let nextAt = 0;
let bar = 0;
let current: SongId | null = null;
const VOLUME = 0.55;

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (ctx && master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
}

function start(id: SongId): void {
  const c = setup();
  void c.resume();
  const song = SONGS[id];
  if (current !== id) bar = 0;
  current = id;
  master!.gain.cancelScheduledValues(c.currentTime);
  master!.gain.setTargetAtTime(VOLUME, c.currentTime, 0.6);
  nextAt = Math.max(nextAt, c.currentTime + 0.1);
  if (timer) clearInterval(timer);
  // look ahead a little so timing never depends on the main thread
  timer = setInterval(() => {
    while (nextAt < c.currentTime + 0.35) {
      nextAt += scheduleBar(song, bar++, nextAt);
    }
  }, 60);
}

export const useMusic = create<MusicState>((set) => ({
  song: null,
  want: (id) => {
    set({ song: id });
    if (id && useSound.getState().on) start(id);
    else stop();
  },
}));

// sound on/off applies to music too
useSound.subscribe((s) => {
  const id = useMusic.getState().song;
  if (s.on && id) start(id);
  else stop();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
  else {
    const id = useMusic.getState().song;
    if (id && useSound.getState().on) start(id);
  }
});

/** The piece for the hour on the player's own clock: day, evening (17–21) or night (21–6). */
export function songForHour(hour: number): SongId {
  if (hour >= 21 || hour < 6) return "night";
  if (hour >= 17) return "evening";
  return "day";
}

/** Keeps the home music in step with the clock; a spar holds its own piece until it ends. */
export function followClock(): () => void {
  const tick = () => {
    if (useMusic.getState().song !== "spar") useMusic.getState().want(songForHour(new Date(now()).getHours()));
  };
  tick();
  const id = setInterval(tick, 60_000);
  return () => clearInterval(id);
}

/* ── room ambience: birds by day, crickets at night, rain on rainy days ─────── */

export type Ambience = "birds" | "crickets" | "rain" | "quiet";

let ambienceTimer: ReturnType<typeof setInterval> | null = null;
let rainNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let ambienceNow: Ambience = "quiet";

function stopAmbience(): void {
  if (ambienceTimer) clearInterval(ambienceTimer);
  ambienceTimer = null;
  if (rainNode && live) {
    const r = rainNode;
    r.gain.gain.setTargetAtTime(0, live.currentTime, 0.4);
    setTimeout(() => r.src.stop(), 1500);
  }
  rainNode = null;
}

/** A bird's two-note call: a quick upward sweep, then a softer echo. */
function birdCall(c: AudioContext, at: number): void {
  const base = 2200 + Math.random() * 1400;
  for (const [delay, vol] of [
    [0, 0.018],
    [0.16, 0.011],
  ] as const) {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(base, at + delay);
    o.frequency.exponentialRampToValueAtTime(base * 1.45, at + delay + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0, at + delay);
    g.gain.linearRampToValueAtTime(vol, at + delay + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + delay + 0.11);
    o.connect(g).connect(c.destination);
    o.start(at + delay);
    o.stop(at + delay + 0.13);
  }
}

/** A cricket's trill: a few fast pulses of a high tone. */
function cricket(c: AudioContext, at: number): void {
  const f = 4200 + Math.random() * 500;
  for (let i = 0; i < 4; i++) {
    const t = at + i * 0.045;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.006, t + 0.008);
    g.gain.linearRampToValueAtTime(0, t + 0.03);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.035);
  }
}

function startAmbience(kind: Ambience): void {
  stopAmbience();
  if (kind === "quiet") return;
  const c = setup();
  void c.resume();
  if (kind === "rain") {
    // soft rain: two seconds of noise, looped, through a low-pass filter
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985;
      d[i] = last * 3 + (Math.random() < 0.0009 ? (Math.random() - 0.5) * 0.6 : 0);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.05, c.currentTime, 1.2);
    src.connect(lp).connect(gain).connect(c.destination);
    src.start();
    rainNode = { src, gain };
    return;
  }
  ambienceTimer = setInterval(() => {
    if (Math.random() < (kind === "birds" ? 0.18 : 0.35))
      (kind === "birds" ? birdCall : cricket)(c, c.currentTime + Math.random() * 0.4);
  }, 1000);
}

/** The game says what the room sounds like; it plays only while sound is on and the tab is seen. */
export function setAmbience(kind: Ambience): void {
  ambienceNow = kind;
  if (useSound.getState().on && !document.hidden) startAmbience(kind);
  else stopAmbience();
}

useSound.subscribe((s) => (s.on ? startAmbience(ambienceNow) : stopAmbience()));
document.addEventListener("visibilitychange", () =>
  document.hidden ? stopAmbience() : useSound.getState().on && startAmbience(ambienceNow),
);
