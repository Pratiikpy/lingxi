/** P5: the pet in words, for a player who cannot see the room, in both languages. */
import { describe, expect, it } from "vitest";
import { type Pet, SUB, createPet, mindBrain } from "@lingxi/game";
import { petDoing, petNeeds, petSpoken } from "./petSpoken";

const pet = (over: Partial<Pet> = {}): Pet => ({
  ...createPet({
    name: "Pip",
    line: "gentle",
    now: 0,
    tzOffsetMin: 0,
    brain: mindBrain({ line: "gentle", lessons: [] }),
  }),
  ...over,
});

describe("the pet in words (P5)", () => {
  it("says what the circuit has the pet doing, or that it is asleep", () => {
    expect(petDoing(pet({ last: { want: 2, mood: 1, nudge: 0, rule: 0, word: 0 } }), "en")).toBe("wants to play");
    expect(petDoing(pet({ last: { want: 2, mood: 1, nudge: 0, rule: 0, word: 0 } }), "zh")).toBe("想玩");
    expect(petDoing(pet({ asleep: true }), "en")).toBe("asleep");
    expect(petDoing(pet({ asleep: true }), "zh")).toBe("在睡觉");
  });

  it("names every need the app's badge counts, and nothing for a pet that is fine", () => {
    const low = pet();
    const hungry = { ...low, meters: { ...low.meters, food: 100 * SUB, energy: 50 * SUB } };
    expect(petNeeds(hungry, "en")).toBe("hungry, tired");
    expect(petNeeds(hungry, "zh")).toBe("饿了、累了");
    expect(petNeeds(pet(), "en")).toBe("");
  });

  it("puts it in one sentence with the name and stage", () => {
    const p = pet({ last: { want: 1, mood: 1, nudge: 0, rule: 0, word: 0 } });
    expect(petSpoken(p, "baby", "en")).toBe("Pip, baby: wants to eat. Needs nothing.");
    expect(petSpoken({ ...p, meters: { ...p.meters, food: 100 * SUB } }, "baby", "en")).toBe(
      "Pip, baby: wants to eat. Hungry.",
    );
    expect(petSpoken(p, "宝宝", "zh")).toBe("Pip，宝宝：想吃东西。什么都不缺。");
  });
});
