import { describe, expect, it } from "vitest";
import { newbornInherits, proposalInherits } from "./inherits";

describe("what a little one inherits, said before it is welcomed (A27)", () => {
  it("the proposal names how many of the pet's lessons go into it, none and one read naturally", () => {
    expect(proposalInherits("Kiri", 13, "en")).toBe("All 13 of Kiri's lessons go into the little one, with its instincts and skills.");
    expect(proposalInherits("Kiri", 1, "en")).toBe("Kiri's one lesson goes into the little one, with its instincts and skills.");
    expect(proposalInherits("Kiri", 0, "en")).toBe("Kiri hasn't learned a lesson yet; its instincts and skills go into the little one.");
    expect(proposalInherits("小桃", 13, "zh")).toBe("小桃的 13 条课都会传给小宝宝，还有它的本能和技能。");
  });

  it("the newborn names both parents' lessons and says whether it can learn yet", () => {
    const a = { name: "Mochi", lessons: Array(13) };
    const b = { name: "Tofu", lessons: [] };
    expect(newbornInherits(a, b, 120, "en")).toBe("It inherits both whole minds: Mochi's 13 lessons and no lessons of Tofu's yet, with their instincts and skills. Whatever you teach it, both halves learn.");
    expect(newbornInherits(a, b, -40, "en")).toMatch(/can learn lessons of its own once it has grown\.$/);
    expect(newbornInherits(a, { name: "豆腐", lessons: [1] }, 0, "zh")).toBe("它继承了父母完整的心智：Mochi的 13 条课、豆腐的 1 条课，还有它们的本能和技能。现在父母的心智把它装满了：等它长大一些，才有空间学自己的新课。");
  });
});
