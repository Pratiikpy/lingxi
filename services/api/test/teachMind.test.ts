/**
 * A11: a lesson in words is checked against the pet's whole mind, with the game's own rule (`checkMindLesson`): the
 * slots its stage, skills and quest 65 give it, its gate budget, a child's two halves, an owned instinct's memory. The
 * server and the game give the same answer for the same pet and lesson; a pet already full is told so before any model
 * is asked.
 */
import { compileProgram, netlistBytes, validateProgram, type Rule } from "@lingxi/brain";
import { MAX_LESSONS, PET_SCHOOL, checkMindLesson, familyOf, lessonCapacity, petCard, type Growth, type MindSpec, type OutsideInstinct } from "@lingxi/game";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";
import { finishProposal } from "../src/teach";

type Stage = "baby" | "child" | "teen" | "adult" | "elder";

/** A pet of level 56 that took every lesson skill (231, 243, 253, 261): five more lessons at every stage. */
const GROWN: Growth = { level: 56, points: 0, skills: { 211: 5, 212: 5, 213: 5, 221: 5, 222: 5, 231: 1, 241: 5, 242: 5, 243: 5, 251: 5, 252: 4, 253: 5, 261: 1 } };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const CPU = "0x00000000000000000000000000000000000000cc";
const instProgram = validateProgram({ version: "LX-PET/1", memory: [{ kind: "flag", name: "met", set: [{ event: [1] }] }], rules: [{ when: { met: [1], time: [0] }, then: { want: 6, mood: 3 } }], otherwise: { want: 0, mood: 1 } });
const OUTSIDE: OutsideInstinct = { processor: CPU, id: "9", owner: "0x00000000000000000000000000000000000000dd", parts: [{ processor: CPU, id: "9", nIn: 16, nOut: 8, hex: hex(netlistBytes(compileProgram(instProgram))) }] };

/**
 * Distinct lessons, as many as asked: Pet School's, then variants of them that answer the same moment another way, so
 * they share its logic and stay within an elder's lesson budget (D3), as a careful teacher's would.
 */
const lessons = (n: number): Rule[] => {
  const school = PET_SCHOOL.map((l) => l.rule);
  const more = Array.from({ length: Math.max(0, n - school.length) }, (_, i) => {
    const r = school[i % school.length]!;
    return { when: r.when, then: { ...r.then, mood: ((r.then.mood ?? 0) + 1 + Math.floor(i / school.length)) % 4 } } as Rule;
  });
  return [...school, ...more].slice(0, n);
};
/** A lesson nobody above was taught. */
const NEW: Rule = { when: { event: [1], joy: [2, 3] }, then: { want: 7, mood: 2, nudge: 6 } };
/** The model's answer that proposes `rule`. */
const proposal = (rule: Rule) => ({ understood: true, rule: { label: "a lesson", when: Object.entries(rule.when).map(([field, values]) => ({ field, values })), then: rule.then }, reply_en: "ok", reply_zh: "好" });

const MINDS: Array<{ name: string; stage: Stage; spec: MindSpec }> = [
  { name: "a baby with room", stage: "baby", spec: { line: "gentle", lessons: [] } },
  { name: "a full baby", stage: "baby", spec: { line: "gentle", lessons: lessons(1) } },
  { name: "a teen with lesson skills, one slot left", stage: "teen", spec: { line: "bold", lessons: lessons(lessonCapacity("teen", GROWN) - 1), growth: GROWN } },
  { name: "a teen with lesson skills, full", stage: "teen", spec: { line: "bold", lessons: lessons(lessonCapacity("teen", GROWN)), growth: GROWN } },
  { name: "an elder with skills and quest 65's slot, one left", stage: "elder", spec: { line: "curious", lessons: lessons(MAX_LESSONS - 1), growth: GROWN, slots: 1 } },
  { name: "an elder at fourteen", stage: "elder", spec: { line: "curious", lessons: lessons(MAX_LESSONS), growth: GROWN, slots: 1 } },
  { name: "a child of two parents", stage: "teen", spec: { line: "gentle", lessons: lessons(1), family: familyOf({ name: "Ada", line: "gentle", lessons: lessons(3) }, { name: "Bo", line: "bold", lessons: lessons(2) }) } },
  { name: "a pet with an owned instinct", stage: "adult", spec: { line: "gentle", lessons: lessons(2), outside: OUTSIDE } },
  { name: "a pet with instincts", stage: "child", spec: { line: "bold", lessons: [], instincts: 5 } },
];

describe("the server checks a lesson as the game does (A11)", () => {
  for (const { name, stage, spec } of MINDS) {
    it(`gives the game's answer for ${name}`, () => {
      for (const candidate of [NEW, ...spec.lessons.slice(0, 1)]) {
        const game = checkMindLesson(spec, stage, candidate);
        const server = finishProposal(proposal(candidate), spec, stage);
        expect(server.ok, `${name}: ${JSON.stringify(candidate)}`).toBe(game.ok);
        if (!server.ok && !game.ok) expect(server.reason).toBe(game.reason);
      }
    });
  }

  it("has minds that fit and minds that are full among them, so the agreement means something", () => {
    const answers = MINDS.map(({ stage, spec }) => checkMindLesson(spec, stage, NEW));
    expect(answers.filter((a) => a.ok).length).toBeGreaterThan(2);
    expect(answers.filter((a) => !a.ok && a.reason === "full").length).toBeGreaterThan(2);
  });
});

/** The server with a model that answers `rule` and counts how often it was asked. */
function serverWithModel(rule: Rule) {
  let asked = 0;
  const client = { beta: { messages: { create: async () => (asked++, { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(proposal(rule)) }] }) } } };
  const app = createApp(client as never);
  const teach = async (body: unknown) => {
    const res = await app.request("/api/teach", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as { ok: boolean; reason?: string } };
  };
  return { teach, asked: () => asked };
}

describe("POST /api/teach with the pet's whole mind (A11)", () => {
  const base = { words: "be glad when a friend comes by", name: "Mochi", line: "curious", stage: "elder" };

  it("teaches an elder holding thirteen lessons, its skills and quest slot giving it room for a fourteenth", async () => {
    const s = serverWithModel(NEW);
    const pet = { lessons: lessons(MAX_LESSONS - 1), growth: GROWN };
    const r = await s.teach({ ...base, lessons: pet.lessons, card: petCard(pet), slots: 1 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true });
    expect(s.asked()).toBe(1);
  });

  it("tells a full pet so without asking the model", async () => {
    const s = serverWithModel(NEW);
    const pet = { lessons: lessons(MAX_LESSONS), growth: GROWN };
    const r = await s.teach({ ...base, lessons: pet.lessons, card: petCard(pet), slots: 1 });
    expect(r.json).toMatchObject({ ok: false, reason: "full" });
    expect(s.asked()).toBe(0);
  });

  it("refuses a damaged card, and fifteen lessons, as bad requests, without asking the model", async () => {
    const s = serverWithModel(NEW);
    expect((await s.teach({ ...base, lessons: [], card: "{ not a card" })).status).toBe(400);
    expect((await s.teach({ ...base, lessons: lessons(MAX_LESSONS + 1) })).status).toBe(400);
    expect(s.asked()).toBe(0);
  });

  it("still answers a page built before the change, which sends its lessons only", async () => {
    const s = serverWithModel(NEW);
    const r = await s.teach({ ...base, stage: "teen", lessons: lessons(2) });
    expect(r.json).toMatchObject({ ok: true });
    const full = await s.teach({ ...base, stage: "teen", lessons: lessons(4) });
    expect(full.json).toMatchObject({ ok: false, reason: "full" });
    expect(s.asked()).toBe(1);
  });
});
