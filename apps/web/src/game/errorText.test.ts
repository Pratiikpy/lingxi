import { describe, expect, it } from "vitest";
import { errorText, firstLine } from "./errorText";

describe("what an error says, whatever was thrown (A21)", () => {
  it("reads an Error, a bare string, and an object carrying a message", () => {
    expect(errorText(new Error("User rejected the request."))).toBe("User rejected the request.");
    expect(errorText("User denied account access")).toBe("User denied account access");
    expect(errorText({ code: 4001, message: "User rejected" })).toBe("User rejected");
  });

  it("never throws: nothing thrown, null, a number, an object without a message", () => {
    expect(errorText(undefined)).toBe("");
    expect(errorText(null)).toBe("");
    expect(errorText(4001)).toBe("4001");
    expect(errorText({ code: 4001 })).toBe('{"code":4001}');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(errorText(loop)).toBe("[object Object]");
  });

  it("gives the first line, trimmed, or the fallback when there is nothing to say", () => {
    expect(firstLine(new Error('The contract function "breed" reverted.\nError: NotAdult(41)'))).toBe('The contract function "breed" reverted.');
    expect(firstLine("  denied  ")).toBe("denied");
    expect(firstLine(undefined)).toBe("failed");
    expect(firstLine(null, "error")).toBe("error");
  });
});
