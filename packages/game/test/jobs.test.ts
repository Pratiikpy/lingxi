import { describe, expect, it } from "vitest";
import { validateProgram } from "@lingxi/brain";
import { JOB, JOBS, maxShiftPay, SHIFTS_PER_DAY, canWork, composeProgram, fitBonus, jobFit, lifeOf, logShift, shiftPay, shiftRounds } from "../src/index";

const always = (want: number) => validateProgram({ version: "LX-PET/1", memory: [], rules: [], otherwise: { want, mood: 1 } });

describe("school and jobs", () => {
  it("children and teens go to school, grown pets work", () => {
    expect(["egg", "baby", "child", "teen", "adult", "elder"].map((s) => lifeOf(s as never))).toEqual(["egg", "baby", "school", "school", "work", "work"]);
  });

  it("a mind that wants what the work needs fits it; teaching changes the fit", () => {
    expect(jobFit(always(7), JOB.cafe)).toBe(1);
    expect(jobFit(always(3), JOB.cafe)).toBe(0);
    expect(jobFit(always(4), JOB.watch)).toBe(1);
    const plain = composeProgram("gentle", []);
    const taught = composeProgram("gentle", [{ when: { event: [1] }, then: { want: 7, mood: 2 } }]);
    expect(jobFit(taught, JOB.cafe)).toBeGreaterThan(jobFit(plain, JOB.cafe));
  });

  it("pay grows with right answers and fit, and is capped", () => {
    expect(fitBonus(0)).toBe(1);
    expect(fitBonus(1)).toBe(1.5);
    expect(shiftPay(10, 0, 0)).toBe(10);
    expect(shiftPay(10, 0, 1)).toBe(15);
    expect(shiftPay(10, 4, 0)).toBe(6);
    expect(shiftPay(3, 9, 1)).toBe(0);
    // excellent play hits the ceiling, and a fitting mind raises the ceiling by half
    expect(shiftPay(100, 0, 0)).toBe(maxShiftPay(0));
    expect(shiftPay(100, 0, 1)).toBe(maxShiftPay(1));
    expect(maxShiftPay(1)).toBe(Math.round(maxShiftPay(0) * 1.5));
  });

  it("a shift's rounds are fixed by its seed and stay within the choices", () => {
    for (const j of JOBS) {
      const r = shiftRounds(j, 42, 50);
      expect(r).toEqual(shiftRounds(j, 42, 50));
      expect(r.every((x) => x >= 0 && x < j.choices)).toBe(true);
      expect(new Set(r).size).toBe(j.choices);
    }
  });

  it("three shifts a day, and the count starts over the next day", () => {
    let log = undefined as ReturnType<typeof logShift> | undefined;
    for (let i = 0; i < SHIFTS_PER_DAY; i++) {
      expect(canWork(log, "d1")).toBe(true);
      log = logShift(log, "d1", 10);
    }
    expect(canWork(log, "d1")).toBe(false);
    expect(canWork(log, "d2")).toBe(true);
    expect(logShift(log, "d2", 5)).toEqual({ day: "d2", shifts: 1, earned: SHIFTS_PER_DAY * 10 + 5 });
  });
});
