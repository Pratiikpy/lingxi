import { describe, expect, it } from "vitest";
import { resultLine } from "./gameResult";

describe("the line after a game (G8)", () => {
  it("never calls a game without a star a great time, in either language", () => {
    expect(resultLine(0, 0, "Pip", "en")).toBe("Score 0. Pip still liked playing with you.");
    expect(resultLine(0, 0, "Pip", "zh")).toBe("得分 0。不过Pip还是喜欢和你一起玩。");
    expect(resultLine(0, 0, "Pip", "en")).not.toMatch(/great/);
  });
  it("grows with the stars", () => {
    expect([1, 2, 3].map((s) => resultLine(9, s, "Pip", "en"))).toEqual(["Score 9. Pip had fun.", "Score 9. Pip had a great time!", "Score 9. Pip loved that one!"]);
    expect([1, 2, 3].map((s) => resultLine(9, s, "Pip", "zh"))).toEqual(["得分 9。Pip玩得挺开心。", "得分 9。Pip玩得很开心！", "得分 9。Pip超爱这一局！"]);
  });
});
