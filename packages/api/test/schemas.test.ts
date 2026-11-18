/**
 * Each schema at and just past every one of its limits, so a limit loosened (or tightened) by accident fails here, and
 * each with the wrong types. These limits came out of the server's security review; the routes' own tests
 * (services/api/test) check what a refusal answers.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { Rule, StarterLine } from "@lingxi/brain";
import { MAX_LESSONS } from "@lingxi/game";
import { SEND_LIMITS } from "@lingxi/chain/limits";
import {
  AgentAdoptBody,
  AgentCareBody,
  AgentTeachBody,
  ArenaOpponentQuery,
  ArenaSnapshotBody,
  BrainRelayPayload,
  ChildRelayPayload,
  GoalsQuery,
  InstinctRelayPayload,
  LessonKeyBody,
  LessonRule,
  LessonShareBody,
  LibraryRule,
  MAX_REMINDERS,
  MAX_WORDS,
  MoveBody,
  MoveSave,
  PAPERS_MAX,
  PapersBody,
  PublishedLog,
  PushPlanBody,
  PushStopBody,
  RelayEnvelope,
  type RelayPayloads,
  SeasonEnterBody,
  SitHomeBody,
  SitLeaveBody,
  SparQuery,
  TeachBody,
  VoiceBody,
  VoucherQuery,
} from "../src/index";

const accepts = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success, JSON.stringify(value)?.slice(0, 200)).toBe(true);
const refuses = (schema: z.ZodType, value: unknown) => expect(schema.safeParse(value).success, JSON.stringify(value)?.slice(0, 200)).toBe(false);
const text = (n: number, ch = "a") => ch.repeat(n);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const ADDRESS = `0x${"ab".repeat(20)}`;
const SIG = `0x${"cd".repeat(65)}`;

describe("a lesson the pet holds (teaching and tape-outs)", () => {
  const rule = { when: { hunger: [0, 15] }, then: { want: 3, mood: 1 } };
  it("takes a rule with or without a nudge and a label", () => {
    accepts(LessonRule, rule);
    accepts(LessonRule, { ...rule, then: { want: 3, mood: 1, nudge: 2 }, label: text(60) });
  });
  it("holds each condition to 0..15, sixteen values at most, whole numbers", () => {
    refuses(LessonRule, { ...rule, when: { hunger: [-1] } });
    refuses(LessonRule, { ...rule, when: { hunger: [16] } });
    refuses(LessonRule, { ...rule, when: { hunger: [1.5] } });
    accepts(LessonRule, { ...rule, when: { hunger: range(16).map((i) => i % 16) } });
    refuses(LessonRule, { ...rule, when: { hunger: range(17).map((i) => i % 16) } });
    refuses(LessonRule, { ...rule, when: { hunger: "1" } });
  });
  it("takes whole numbers for what it wants and its mood, and a label of 60 characters at most", () => {
    refuses(LessonRule, { ...rule, then: { want: 1.5, mood: 1 } });
    refuses(LessonRule, { ...rule, then: { want: 1, mood: 1, nudge: 0.5 } });
    refuses(LessonRule, { ...rule, then: { want: 1 } });
    refuses(LessonRule, { ...rule, label: text(61) });
  });
});

describe("POST /api/teach", () => {
  const body = { words: "when you are hungry, ask for food", name: "Mochi", line: "gentle", stage: "baby", lessons: [] };
  it("takes a request the game sends", () => accepts(TeachBody, body));
  it(`takes 1 to ${MAX_WORDS} characters of words`, () => {
    refuses(TeachBody, { ...body, words: "" });
    accepts(TeachBody, { ...body, words: text(MAX_WORDS) });
    refuses(TeachBody, { ...body, words: text(MAX_WORDS + 1) });
    expect(MAX_WORDS).toBe(240);
  });
  it("takes a name of 40 characters at most, or none", () => {
    accepts(TeachBody, { ...body, name: text(40) });
    refuses(TeachBody, { ...body, name: text(41) });
    const { name: _name, ...nameless } = body;
    accepts(TeachBody, nameless);
  });
  it("takes the three lines and the five hatched stages, nothing else", () => {
    for (const line of ["gentle", "bold", "curious"]) accepts(TeachBody, { ...body, line });
    refuses(TeachBody, { ...body, line: "sly" });
    for (const stage of ["baby", "child", "teen", "adult", "elder"]) accepts(TeachBody, { ...body, stage });
    refuses(TeachBody, { ...body, stage: "egg" });
  });
  it("takes eight lessons at most", () => {
    const lesson = { when: { hunger: [1] }, then: { want: 1, mood: 0 } };
    accepts(TeachBody, { ...body, lessons: range(8).map(() => lesson) });
    refuses(TeachBody, { ...body, lessons: range(9).map(() => lesson) });
  });
  it("refuses the wrong types", () => {
    refuses(TeachBody, { ...body, words: 42 });
    refuses(TeachBody, { ...body, lessons: "none" });
    refuses(TeachBody, null);
  });
});

describe("the relay routes", () => {
  const envelope = { kind: "brain", petId: "7", payload: "{}", auth: { signer: ADDRESS, nonce: "ab".repeat(16), time: 1_700_000_000, signature: SIG } };
  it("take a signed envelope of kind brain, child or instinct, never a season entry", () => {
    for (const kind of ["brain", "child", "instinct"]) accepts(RelayEnvelope, { ...envelope, kind });
    refuses(RelayEnvelope, { ...envelope, kind: "season" });
  });
  it("hold the pet id to 1-20 digits and the payload to 20,000 characters", () => {
    accepts(RelayEnvelope, { ...envelope, petId: text(20, "9") });
    refuses(RelayEnvelope, { ...envelope, petId: text(21, "9") });
    refuses(RelayEnvelope, { ...envelope, petId: "" });
    refuses(RelayEnvelope, { ...envelope, petId: "1a" });
    accepts(RelayEnvelope, { ...envelope, payload: text(20_000) });
    refuses(RelayEnvelope, { ...envelope, payload: text(20_001) });
  });
  it("need every part of the signature, with the time as a number", () => {
    const { auth: _auth, ...unsigned } = envelope;
    refuses(RelayEnvelope, unsigned);
    refuses(RelayEnvelope, { ...envelope, auth: { ...envelope.auth, time: "1700000000" } });
    refuses(RelayEnvelope, { ...envelope, auth: { ...envelope.auth, signature: undefined } });
  });

  const brain = { line: "bold", lessons: [], instincts: 5, skills: [101] };
  it(`a brain: ${MAX_LESSONS} lessons at most, instincts 0..15, eight skills of 100..999`, () => {
    accepts(BrainRelayPayload, brain);
    accepts(BrainRelayPayload, { line: "bold", lessons: [] });
    const lesson = { when: { hunger: [1] }, then: { want: 1, mood: 0 } };
    accepts(BrainRelayPayload, { ...brain, lessons: range(MAX_LESSONS).map(() => lesson) });
    refuses(BrainRelayPayload, { ...brain, lessons: range(MAX_LESSONS + 1).map(() => lesson) });
    expect(MAX_LESSONS).toBe(14);
    accepts(BrainRelayPayload, { ...brain, instincts: 0 });
    accepts(BrainRelayPayload, { ...brain, instincts: 15 });
    refuses(BrainRelayPayload, { ...brain, instincts: 16 });
    refuses(BrainRelayPayload, { ...brain, instincts: -1 });
    refuses(BrainRelayPayload, { ...brain, instincts: 1.5 });
    accepts(BrainRelayPayload, { ...brain, skills: [100, 999] });
    refuses(BrainRelayPayload, { ...brain, skills: [99] });
    refuses(BrainRelayPayload, { ...brain, skills: [1000] });
    accepts(BrainRelayPayload, { ...brain, skills: range(8).map((i) => 100 + i) });
    refuses(BrainRelayPayload, { ...brain, skills: range(9).map((i) => 100 + i) });
    refuses(BrainRelayPayload, { ...brain, line: "sly" });
  });
  it("a child: exactly two parents by number, or a card of 10,000 characters at most", () => {
    accepts(ChildRelayPayload, { parents: ["1", "2"] });
    refuses(ChildRelayPayload, { parents: ["1"] });
    refuses(ChildRelayPayload, { parents: ["1", "2", "3"] });
    refuses(ChildRelayPayload, { parents: ["1", "x"] });
    refuses(ChildRelayPayload, { parents: ["1", text(21, "9")] });
    accepts(ChildRelayPayload, { card: text(10_000) });
    refuses(ChildRelayPayload, { card: text(10_001) });
    refuses(ChildRelayPayload, {});
  });
  it("an instinct: the pet, the processor's address and the circuit", () => {
    const instinct = { own: "3", processor: ADDRESS, id: "12" };
    accepts(InstinctRelayPayload, instinct);
    refuses(InstinctRelayPayload, { ...instinct, processor: ADDRESS.slice(0, -1) });
    refuses(InstinctRelayPayload, { ...instinct, processor: `${ADDRESS}0` });
    refuses(InstinctRelayPayload, { ...instinct, own: "three" });
    refuses(InstinctRelayPayload, { ...instinct, id: 12 });
  });
});

describe("POST /api/voice", () => {
  const body = { name: "Mochi", lang: "en", stage: "baby", line: "gentle", decision: "ask for food", because: ["very hungry"], meters: { food: 100, joy: 500, energy: 800, clean: 800 }, sick: false, asleep: false };
  it("takes a request the game sends, the moment defaulting to decided", () => {
    const parsed = VoiceBody.parse(body);
    expect(parsed.moment).toBe("decided");
    expect(VoiceBody.parse({ ...body, moment: "petted" }).moment).toBe("petted");
    refuses(VoiceBody, { ...body, moment: "poked" });
  });
  it("holds the name to 1-24 characters and the decision to 1-60", () => {
    refuses(VoiceBody, { ...body, name: "" });
    accepts(VoiceBody, { ...body, name: text(24) });
    refuses(VoiceBody, { ...body, name: text(25) });
    refuses(VoiceBody, { ...body, decision: "" });
    accepts(VoiceBody, { ...body, decision: text(60) });
    refuses(VoiceBody, { ...body, decision: text(61) });
  });
  it("takes six reasons of 60 characters at most", () => {
    accepts(VoiceBody, { ...body, because: range(6).map(() => text(60)) });
    refuses(VoiceBody, { ...body, because: range(7).map(() => "x") });
    refuses(VoiceBody, { ...body, because: [text(61)] });
  });
  it("holds every meter to a whole 0..1000", () => {
    for (const m of ["food", "joy", "energy", "clean"] as const) {
      accepts(VoiceBody, { ...body, meters: { ...body.meters, [m]: 0 } });
      accepts(VoiceBody, { ...body, meters: { ...body.meters, [m]: 1000 } });
      refuses(VoiceBody, { ...body, meters: { ...body.meters, [m]: -1 } });
      refuses(VoiceBody, { ...body, meters: { ...body.meters, [m]: 1001 } });
      refuses(VoiceBody, { ...body, meters: { ...body.meters, [m]: 1.5 } });
    }
  });
  it("refuses an unknown language, line or stage, and the wrong types", () => {
    refuses(VoiceBody, { ...body, lang: "fr" });
    refuses(VoiceBody, { ...body, line: "sly" });
    refuses(VoiceBody, { ...body, stage: "egg" });
    refuses(VoiceBody, { ...body, sick: "no" });
    refuses(VoiceBody, { ...body, because: "hungry" });
  });
});

describe("pet-sitting", () => {
  it("POST /api/sit: the pack and the key's hash as text, the time it is due as a number", () => {
    const body = { pack: "{}", keyHash: "ab", until: 1_700_000_000_000 };
    accepts(SitLeaveBody, body);
    refuses(SitLeaveBody, { ...body, until: "soon" });
    refuses(SitLeaveBody, { keyHash: "ab", until: 1 });
    refuses(SitLeaveBody, { ...body, pack: {} });
  });
  it("POST /api/sit/:code/home: the key and the pet as text", () => {
    accepts(SitHomeBody, { key: "k", pet: "{}" });
    refuses(SitHomeBody, { key: "k", pet: {} });
    refuses(SitHomeBody, { pet: "{}" });
  });
});

describe("the arena", () => {
  it("POST /api/arena/snapshot: a whole round and the device; the pet and team are the store's to check", () => {
    const body = { round: 3, pet: { name: "Mochi" }, team: ["pip"], device: "d".repeat(32) };
    accepts(ArenaSnapshotBody, body);
    accepts(ArenaSnapshotBody, { ...body, pet: null, team: 5 });
    refuses(ArenaSnapshotBody, { ...body, round: 1.5 });
    refuses(ArenaSnapshotBody, { ...body, round: "3" });
    refuses(ArenaSnapshotBody, { ...body, device: 7 });
  });
  it("GET /api/arena/opponent: a round as Number() reads it, whole and not negative, and a device of 8-64 characters", () => {
    const q = { round: "4", device: "d".repeat(32) };
    expect(ArenaOpponentQuery.parse(q)).toEqual({ round: 4, device: q.device });
    accepts(ArenaOpponentQuery, { ...q, round: "0" });
    // Number("") is 0, as the route read it before this schema
    expect(ArenaOpponentQuery.parse({ ...q, round: "" }).round).toBe(0);
    // whole numbers past the safe range stay whole numbers, as Number.isInteger reads them
    accepts(ArenaOpponentQuery, { ...q, round: "1e300" });
    refuses(ArenaOpponentQuery, { ...q, round: "-1" });
    refuses(ArenaOpponentQuery, { ...q, round: "1.5" });
    refuses(ArenaOpponentQuery, { ...q, round: "abc" });
    refuses(ArenaOpponentQuery, { ...q, round: "Infinity" });
    refuses(ArenaOpponentQuery, { device: q.device });
    accepts(ArenaOpponentQuery, { ...q, device: text(8) });
    accepts(ArenaOpponentQuery, { ...q, device: text(64) });
    refuses(ArenaOpponentQuery, { ...q, device: text(7) });
    refuses(ArenaOpponentQuery, { ...q, device: text(65) });
    refuses(ArenaOpponentQuery, { round: "1" });
  });
});

describe("POST /api/season/enter", () => {
  it("takes the pet as the store will check it, the device, and a proof or none", () => {
    accepts(SeasonEnterBody, { pet: { name: "Mochi" }, device: "d".repeat(32) });
    accepts(SeasonEnterBody, { pet: { name: "Mochi" }, device: "d".repeat(32), proof: { kind: "season" } });
    refuses(SeasonEnterBody, { pet: {} });
    refuses(SeasonEnterBody, { pet: {}, device: 1 });
  });
});

describe("the lesson library", () => {
  const rule = { when: { hunger: [3] }, then: { want: 15, mood: 3, nudge: 15 } };
  it("a shared rule: field names of 24 characters, 1-16 values of 0..15, want and nudge 0..15, mood 0..3", () => {
    accepts(LibraryRule, rule);
    accepts(LibraryRule, { ...rule, when: { [text(24)]: [0] } });
    refuses(LibraryRule, { ...rule, when: { [text(25)]: [0] } });
    refuses(LibraryRule, { ...rule, when: { hunger: [] } });
    accepts(LibraryRule, { ...rule, when: { hunger: range(16).map((i) => i % 16) } });
    refuses(LibraryRule, { ...rule, when: { hunger: range(17).map((i) => i % 16) } });
    refuses(LibraryRule, { ...rule, when: { hunger: [16] } });
    refuses(LibraryRule, { ...rule, then: { want: 16, mood: 0 } });
    refuses(LibraryRule, { ...rule, then: { want: -1, mood: 0 } });
    refuses(LibraryRule, { ...rule, then: { want: 0, mood: 4 } });
    refuses(LibraryRule, { ...rule, then: { want: 0, mood: 0, nudge: 16 } });
    accepts(LibraryRule, { ...rule, label: text(60) });
    refuses(LibraryRule, { ...rule, label: text(61) });
  });
  it("POST /api/lessons/share: the rule and a name of 40 characters at most", () => {
    accepts(LessonShareBody, { rule, by: text(40) });
    refuses(LessonShareBody, { rule, by: text(41) });
    refuses(LessonShareBody, { rule });
  });
  it("POST /api/lessons/use and /report: a key of 24 lower-case hex digits", () => {
    accepts(LessonKeyBody, { key: "0123456789abcdef01234567" });
    refuses(LessonKeyBody, { key: "0123456789ABCDEF01234567" });
    refuses(LessonKeyBody, { key: "0123456789abcdef0123456" });
    refuses(LessonKeyBody, { key: "0123456789abcdef012345678" });
  });
});

describe("POST /api/pets/:id/log", () => {
  const log = { petId: "1", words: [1, 2], segments: [{ brainId: "34", words: [1, 2] }] };
  it("takes a log the game publishes, a segment's brain unknown or by number", () => {
    accepts(PublishedLog, log);
    accepts(PublishedLog, { ...log, segments: [{ brainId: null, words: [1, 2] }] });
  });
  it("holds the pet to 1-12 digits and a brain to 1-20", () => {
    accepts(PublishedLog, { ...log, petId: text(12, "9") });
    refuses(PublishedLog, { ...log, petId: text(13, "9") });
    accepts(PublishedLog, { ...log, segments: [{ brainId: text(20, "9"), words: [] }] });
    refuses(PublishedLog, { ...log, segments: [{ brainId: text(21, "9"), words: [] }] });
  });
  it(`takes 1 to ${SEND_LIMITS.logWords} words of 0..65535, and 1 to 64 segments`, () => {
    refuses(PublishedLog, { ...log, words: [] });
    accepts(PublishedLog, { ...log, words: range(SEND_LIMITS.logWords).map(() => 65535) });
    refuses(PublishedLog, { ...log, words: range(SEND_LIMITS.logWords + 1).map(() => 0) });
    refuses(PublishedLog, { ...log, words: [65536] });
    refuses(PublishedLog, { ...log, words: [-1] });
    refuses(PublishedLog, { ...log, words: [1.5] });
    refuses(PublishedLog, { ...log, segments: [] });
    accepts(PublishedLog, { ...log, segments: range(64).map(() => ({ brainId: null, words: [] })) });
    refuses(PublishedLog, { ...log, segments: range(65).map(() => ({ brainId: null, words: [] })) });
    refuses(PublishedLog, { ...log, segments: [{ brainId: null, words: range(SEND_LIMITS.logWords + 1).map(() => 0) }] });
    expect(SEND_LIMITS.logWords).toBe(100_000);
  });
});

describe("POST /api/move", () => {
  it("takes 1 to 64 of the game's stores by key, each as text", () => {
    accepts(MoveBody, { save: { "lingxi.pets.v2": "[]" } });
    accepts(MoveSave, Object.fromEntries(range(64).map((i) => [`lingxi.k${i}`, "x"])));
    refuses(MoveSave, Object.fromEntries(range(65).map((i) => [`lingxi.k${i}`, "x"])));
    refuses(MoveSave, {});
    refuses(MoveBody, {});
  });
  it("names a store lingxi. and 1-40 letters, digits, dots, dashes or underscores", () => {
    accepts(MoveSave, { [`lingxi.${text(40)}`]: "x" });
    refuses(MoveSave, { [`lingxi.${text(41)}`]: "x" });
    accepts(MoveSave, { "LINGXI.Pets.V2": "x" });
    refuses(MoveSave, { "lingxi.": "x" });
    refuses(MoveSave, { "other.pets": "x" });
    refuses(MoveSave, { "lingxi.pets~copy": "x" });
  });
  it(`holds each store to ${SEND_LIMITS.moveChars} characters`, () => {
    accepts(MoveSave, { "lingxi.big": text(SEND_LIMITS.moveChars) });
    refuses(MoveSave, { "lingxi.big": text(SEND_LIMITS.moveChars + 1) });
    refuses(MoveSave, { "lingxi.pets": 5 });
    expect(SEND_LIMITS.moveChars).toBe(3_000_000);
  });
});

describe("reminders", () => {
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: text(87, "B"), auth: text(22, "C") } };
  const plan = { subscription: sub, lang: "zh", name: "Mochi", tz: 480, reminders: [{ kind: "hungry", at: 1_700_000_000_000 }] };
  it("POST /api/push/plan: takes a plan the game sends", () => accepts(PushPlanBody, plan));
  it("holds the endpoint to a URL of 800 characters and the keys to their sizes", () => {
    const url = (n: number) => `https://fcm.googleapis.com/${text(n - "https://fcm.googleapis.com/".length)}`;
    accepts(PushPlanBody, { ...plan, subscription: { ...sub, endpoint: url(800) } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, endpoint: url(801) } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, endpoint: "not a url" } });
    accepts(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(16), auth: text(8) } } });
    accepts(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(200), auth: text(100) } } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(15), auth: text(8) } } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(201), auth: text(8) } } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(16), auth: text(7) } } });
    refuses(PushPlanBody, { ...plan, subscription: { ...sub, keys: { p256dh: text(16), auth: text(101) } } });
  });
  it("holds the name to 1-24 characters, the offset to whole minutes within 14 hours, and the language", () => {
    refuses(PushPlanBody, { ...plan, name: "" });
    accepts(PushPlanBody, { ...plan, name: text(24) });
    refuses(PushPlanBody, { ...plan, name: text(25) });
    accepts(PushPlanBody, { ...plan, tz: -840 });
    accepts(PushPlanBody, { ...plan, tz: 840 });
    refuses(PushPlanBody, { ...plan, tz: -841 });
    refuses(PushPlanBody, { ...plan, tz: 841 });
    refuses(PushPlanBody, { ...plan, tz: 330.5 });
    refuses(PushPlanBody, { ...plan, lang: "fr" });
  });
  it(`takes ${MAX_REMINDERS} reminders at most, of the four needs, at whole milliseconds`, () => {
    accepts(PushPlanBody, { ...plan, reminders: range(MAX_REMINDERS).map(() => ({ kind: "sick", at: 1 })) });
    refuses(PushPlanBody, { ...plan, reminders: range(MAX_REMINDERS + 1).map(() => ({ kind: "sick", at: 1 })) });
    for (const kind of ["hungry", "bored", "dirty", "sick"]) accepts(PushPlanBody, { ...plan, reminders: [{ kind, at: 1 }] });
    refuses(PushPlanBody, { ...plan, reminders: [{ kind: "sleepy", at: 1 }] });
    refuses(PushPlanBody, { ...plan, reminders: [{ kind: "hungry", at: 1.5 }] });
    expect(MAX_REMINDERS).toBe(6);
  });
  it("POST /api/push/stop: an endpoint of 800 characters at most", () => {
    accepts(PushStopBody, { endpoint: text(800) });
    refuses(PushStopBody, { endpoint: text(801) });
    refuses(PushStopBody, {});
  });
});

describe("goals and vouchers", () => {
  const w = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
  it("GET /api/goals: no wallet, or up to eight wallets, comma-separated", () => {
    expect(GoalsQuery.parse({}).wallet).toEqual([]);
    expect(GoalsQuery.parse({ wallet: "" }).wallet).toEqual([]);
    expect(GoalsQuery.parse({ wallet: `${w(1)},,${w(2)},` }).wallet).toEqual([w(1), w(2)]);
    accepts(GoalsQuery, { wallet: range(8).map(w).join(",") });
    refuses(GoalsQuery, { wallet: range(9).map(w).join(",") });
    refuses(GoalsQuery, { wallet: `${w(1)},0x12` });
    refuses(GoalsQuery, { wallet: `${w(1)}0` });
  });
  it("GET /api/voucher: a wallet, and the goal (none reads as an empty name)", () => {
    expect(VoucherQuery.parse({ wallet: ADDRESS, goal: "g1" })).toEqual({ wallet: ADDRESS, goal: "g1" });
    expect(VoucherQuery.parse({ wallet: ADDRESS }).goal).toBe("");
    refuses(VoucherQuery, { goal: "g1" });
    refuses(VoucherQuery, { wallet: "0x12", goal: "g1" });
  });
});

describe("POST /api/papers/:petId", () => {
  it(`takes papers of ${PAPERS_MAX} characters at most that read as JSON, and a 65-byte signature`, () => {
    accepts(PapersBody, { papers: '{"v":1}', signature: SIG });
    accepts(PapersBody, { papers: `"${text(PAPERS_MAX - 2)}"`, signature: SIG });
    refuses(PapersBody, { papers: `"${text(PAPERS_MAX - 1)}"`, signature: SIG });
    refuses(PapersBody, { papers: "{not json", signature: SIG });
    refuses(PapersBody, { papers: '{"v":1}', signature: SIG.slice(0, -1) });
    refuses(PapersBody, { papers: '{"v":1}', signature: `${SIG}0` });
    refuses(PapersBody, { papers: '{"v":1}', signature: `0x${text(130, "g")}` });
    refuses(PapersBody, { papers: { v: 1 }, signature: SIG });
    refuses(PapersBody, null);
    expect(PAPERS_MAX).toBe(600_000);
  });
});

describe("GET /api/v1/spar", () => {
  it("reads every part as text, all of them optional", () => {
    accepts(SparQuery, {});
    expect(SparQuery.parse({ chips: "punish,block,bite", vs: "pip", seed: "7", other: "x" })).toEqual({ chips: "punish,block,bite", vs: "pip", seed: "7" });
    refuses(SparQuery, { seed: 7 });
  });
});

describe("the agents' bodies", () => {
  it("take any object, every part optional and left to the agent store to check, and nothing else", () => {
    for (const schema of [AgentAdoptBody, AgentCareBody, AgentTeachBody]) {
      accepts(schema, {});
      refuses(schema, null);
      refuses(schema, 5);
      refuses(schema, "body");
      refuses(schema, []);
    }
    expect(AgentAdoptBody.parse({ agent: 12345, name: "Bit", line: "bold", instincts: "3", extra: 1 })).toEqual({ agent: 12345, name: "Bit", line: "bold", instincts: "3" });
    expect(AgentCareBody.parse({ action: "feed", food: "mochi" })).toEqual({ action: "feed", food: "mochi" });
    expect(AgentTeachBody.parse({ rule: { when: {}, then: { want: 1, mood: 0 } } })).toEqual({ rule: { when: {}, then: { want: 1, mood: 0 } } });
  });
});

describe("what the server holds once parsed", () => {
  it("is what its own code takes", () => {
    expectTypeOf<z.output<typeof LessonRule>>().toMatchTypeOf<Rule>();
    expectTypeOf<z.output<typeof LibraryRule>>().toMatchTypeOf<Rule>();
    expectTypeOf<z.output<typeof TeachBody>["line"]>().toEqualTypeOf<StarterLine>();
    expectTypeOf<z.output<typeof BrainRelayPayload>["line"]>().toEqualTypeOf<StarterLine>();
    expectTypeOf<keyof RelayPayloads>().toEqualTypeOf<z.output<typeof RelayEnvelope>["kind"]>();
  });
});
