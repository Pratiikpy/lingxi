import { describe, expect, it, vi } from "vitest";

vi.mock("./sound", () => ({ useSound: { getState: () => ({ on: false }), subscribe: () => () => {} } }));
vi.stubGlobal("document", { addEventListener: () => {}, hidden: false });

const { SONGS, chordTones, freq, steps } = await import("./music");

describe("our music", () => {
  it("tunes A4 to 440 Hz and keeps octaves exact", () => {
    expect(freq("A4")).toBeCloseTo(440, 6);
    expect(freq("A5") / freq("A4")).toBeCloseTo(2, 9);
    expect(freq("C4")).toBeCloseTo(261.626, 2);
  });

  for (const [id, song] of Object.entries(SONGS)) {
    it(`${id}: every bar has eight steps, real notes, and never holds after silence`, () => {
      expect(song.melody.length).toBe(song.chords.length);
      for (const line of song.melody) {
        const s = steps(line);
        expect(s).toHaveLength(8);
        expect(s[0]).not.toBe("-");
        s.forEach((n, i) => {
          if (n === "-") expect(s[i - 1]).not.toBe(".");
          else if (n !== ".") expect(() => freq(n)).not.toThrow();
        });
      }
      for (const c of song.chords) expect(() => chordTones(c)).not.toThrow();
    });

    it(`${id}: the melody sits in a singable, pleasant range`, () => {
      const notes = song.melody.flatMap(steps).filter((n) => n !== "-" && n !== ".");
      const fs = notes.map(freq);
      expect(Math.min(...fs)).toBeGreaterThanOrEqual(freq("G4") - 0.01);
      expect(Math.max(...fs)).toBeLessThanOrEqual(freq("C6") + 0.01);
    });
  }

  it("the downbeat of each bar is a tone of its chord (no clashes on the strong beat)", () => {
    for (const song of Object.values(SONGS)) {
      song.melody.forEach((line, bar) => {
        const first = steps(line)[0]!;
        if (first === ".") return;
        const { root, tones } = chordTones(song.chords[bar]!);
        const semis = Math.round(12 * Math.log2(freq(`${first.slice(0, -1)}4`) / freq(`${root}4`)));
        expect(tones.map((t) => t % 12)).toContain(((semis % 12) + 12) % 12);
      });
    }
  });
});
