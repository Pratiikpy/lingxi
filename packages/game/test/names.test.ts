import { describe, expect, it } from "vitest";
import { compileProgram, netlistBytes } from "@lingxi/brain";
import { composeProgram } from "../src/lessons";
import { nameFromBrain, shownName } from "../src/names";
import { friendPartner } from "../src/partners";
import { parseCard } from "../src/family";

const bytes = (line: "gentle" | "bold" | "curious", instincts = 0) => netlistBytes(compileProgram(composeProgram(line, [], instincts)));

describe("names from the brain", () => {
  it("the same circuit always gives the same name, a different circuit a different one", () => {
    expect(nameFromBrain(bytes("gentle"))).toEqual(nameFromBrain(bytes("gentle")));
    const names = new Set<string>();
    for (const line of ["gentle", "bold", "curious"] as const) for (let i = 0; i < 16; i++) names.add(nameFromBrain(bytes(line, i)).en);
    expect(names.size).toBeGreaterThan(30);
  });

  it("each draw gives another name, short, in both languages", () => {
    const b = bytes("curious", 4);
    const draws = Array.from({ length: 12 }, (_, k) => nameFromBrain(b, k));
    expect(new Set(draws.map((d) => d.en)).size).toBeGreaterThan(8);
    for (const d of draws) {
      expect(d.en).toMatch(/^[A-Z][a-z]{2,8}$/);
      expect([...d.zh]).toHaveLength(2);
      expect(d.from).toMatch(/^0x[0-9a-f]{8}$/);
    }
  });
});

describe("another player's pet name, as the game shows it (A16)", () => {
  it("shows a character that shows as nothing, so a name can never pass for another", () => {
    expect(shownName("Mochi\u061c", 12)).toBe("Mochi\ufffd");
    expect(shownName("Mo\u200bchi", 12)).toBe("Mo\ufffdchi");
    expect(shownName("Mochi\u{1d173}", 12)).toBe("Mochi\ufffd");
  });

  it("drops control characters and angle brackets, trims, and leaves an ordinary name as it is", () => {
    expect(shownName("  <Mo\u0007chi>  ", 12)).toBe("Mochi");
    expect(shownName("团子 🐱", 12)).toBe("团子 🐱");
    expect(shownName(42, 12)).toBe("");
  });

  it("shows visible punctuation and emoji as they are: only what draws as nothing is marked", () => {
    for (const name of ["Mo\u2026", "Pip \u2014 Tofu", "\u2018Mochi\u2019"]) expect(shownName(name, 12)).toBe(name);
    const emoji = ["Pip \u2764\ufe0f", "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}", "1\ufe0f\u20e3", "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}", "\u{1f44b}\u{1f3fd}"];
    for (const name of emoji) expect(shownName(name, 24), name).toBe(name);
  });

  it("marks a joiner or selector that belongs to no emoji, and a space that is not a space", () => {
    expect(shownName("Mochi\u200d", 12)).toBe("Mochi\ufffd");
    expect(shownName("Moc\ufe0fhi", 12)).toBe("Moc\ufffdhi");
    expect(shownName("Mo\u00a0chi", 12)).toBe("Mo\ufffdchi");
    expect(shownName("Mo\u3000chi", 12)).toBe("Mo\ufffdchi");
    expect(shownName("\u{1f431}\u200dMochi", 12)).toBe("\u{1f431}\ufffdMochi");
  });

  it("stays quick on a hostile name: a long run of flag tags or joiners is read only so far", () => {
    const started = performance.now();
    expect(shownName("\u{1f3f4}" + "\u{e0067}".repeat(200_000), 12)).toBe("\u{1f3f4}" + "\u{e0067}".repeat(5));
    expect(shownName("\u200d".repeat(200_000), 12)).toBe("\ufffd".repeat(12));
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("cuts a long name without splitting a character in two", () => {
    expect(shownName("abcdefghijk🐱", 12)).toBe("abcdefghijk");
    expect(shownName("abcdefghijklmnop", 12)).toBe("abcdefghijkl");
  });

  it("is how a friend's card and a family's papers carry a name", () => {
    const friend = friendPartner({ id: "abc", name: "Tofu\u061c", line: "bold", stage: "teen", lessons: "[]" });
    expect(friend?.name.en).toBe("Tofu\ufffd");
    const papers = parseCard(
      JSON.stringify({ lessons: [], family: { generation: 1, parents: [{ name: "Mochi\u180b", line: "gentle", lessons: [] }, { name: "Pip", line: "bold", lessons: [] }] } }),
    );
    expect(papers?.family?.parents.map((p) => p.name)).toEqual(["Mochi\ufffd", "Pip"]);
  });
});

