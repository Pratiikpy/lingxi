import { describe, expect, expectTypeOf, it } from "vitest";
import * as schema from "@lingxi/api-schema";
import type { Rule } from "@lingxi/brain";
import type { SignedRelay } from "@lingxi/chain";
import { parseCard, petCard, type DuelPet } from "@lingxi/game";
import type { relayBrain, relayChild, relayInstinct, signRelayRequest, teachInWords } from "./api";
import * as req from "./requests";

const WALLET = `0x${"ab".repeat(20)}`;
const SIG = `0x${"cd".repeat(65)}`;
const pet: DuelPet = { name: "Mochi", line: "gentle", stage: "baby", card: "[]", story: { days: 1, lessons: 0, nature: [] } };
const rule: Rule = { when: { hunger: [3] }, then: { want: 2, mood: 1 }, label: "my own words" };
/** A query as the server reads it: the URL's search parameters, first value of each. */
const queryOf = (url: string) => Object.fromEntries(new URL(url, "http://localhost").searchParams);

describe("the game's requests are the server's own types", () => {
  it("each builder returns exactly the shared type", () => {
    expectTypeOf(req.teachBody).returns.toEqualTypeOf<schema.TeachBody>();
    expectTypeOf(req.voiceBody).returns.toEqualTypeOf<schema.VoiceBody>();
    expectTypeOf(req.sitLeaveBody).returns.toEqualTypeOf<schema.SitLeaveBody>();
    expectTypeOf(req.sitHomeBody).returns.toEqualTypeOf<schema.SitHomeBody>();
    expectTypeOf(req.arenaSnapshotBody).returns.toEqualTypeOf<schema.ArenaSnapshotBody>();
    expectTypeOf(req.arenaOpponentQuery).returns.toEqualTypeOf<schema.ArenaOpponentQuery>();
    expectTypeOf(req.seasonEnterBody).returns.toEqualTypeOf<schema.SeasonEnterBody>();
    expectTypeOf(req.lessonShareBody).returns.toEqualTypeOf<schema.LessonShareBody>();
    expectTypeOf(req.lessonKeyBody).returns.toEqualTypeOf<schema.LessonKeyBody>();
    expectTypeOf(req.diaryBody).returns.toEqualTypeOf<schema.PublishedLog>();
    expectTypeOf(req.moveBody).returns.toEqualTypeOf<schema.MoveBody>();
    expectTypeOf(req.pushPlanBody).returns.toEqualTypeOf<schema.PushPlanBody>();
    expectTypeOf(req.pushStopBody).returns.toEqualTypeOf<schema.PushStopBody>();
    expectTypeOf(req.goalsQuery).returns.toEqualTypeOf<schema.GoalsQuery>();
    expectTypeOf(req.voucherQuery).returns.toEqualTypeOf<schema.VoucherQuery>();
    expectTypeOf(req.papersBody).returns.toEqualTypeOf<schema.PapersBody>();
  });

  it("the senders take the shared types, and each relay route only its own kind", () => {
    expectTypeOf<Parameters<typeof teachInWords>[0]>().toEqualTypeOf<schema.TeachBody>();
    expectTypeOf<Parameters<typeof relayBrain>[0]>().toEqualTypeOf<schema.RelayEnvelopeOf<"brain">>();
    expectTypeOf<Parameters<typeof relayChild>[0]>().toEqualTypeOf<schema.RelayEnvelopeOf<"child">>();
    expectTypeOf<Parameters<typeof relayInstinct>[0]>().toEqualTypeOf<schema.RelayEnvelopeOf<"instinct">>();
    expectTypeOf<Parameters<typeof signRelayRequest<"brain">>[3]>().toEqualTypeOf<schema.BrainRelayPayload>();
    expectTypeOf<Parameters<typeof signRelayRequest<"child">>[3]>().toEqualTypeOf<schema.ChildRelayPayload>();
    expectTypeOf<Parameters<typeof signRelayRequest<"instinct">>[3]>().toEqualTypeOf<schema.InstinctRelayPayload>();
    expectTypeOf<SignedRelay<"brain">>().toMatchTypeOf<schema.RelayEnvelopeOf<"brain">>();
    expectTypeOf<SignedRelay<"child">>().not.toMatchTypeOf<schema.RelayEnvelopeOf<"brain">>();
    expectTypeOf<SignedRelay<"season">>().not.toMatchTypeOf<schema.RelayEnvelope>();
  });
});

describe("what the builders send is what the server accepts", () => {
  it("teaching, with the pet's whole mind as its card and the player's quest slots (A11)", () => {
    const pet = { name: "Mochi", line: "bold" as const, lessons: [rule], instincts: 5, growth: { level: 2, points: 0, skills: { 211: 1, 212: 1 } } };
    const body = req.teachBody("ask for food when hungry", pet, "teen", 1);
    expect(schema.TeachBody.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ lessons: [rule], slots: 1 });
    // the card the server reads the mind from is the one the game shares everywhere else
    expect(body.card).toBe(petCard(pet));
    expect(parseCard(body.card!)).toMatchObject({ lessons: [rule], instincts: 5, growth: pet.growth });
  });

  it("the voice, with the decision and reasons cut to the server's lengths", () => {
    const body = req.voiceBody({ pet: { name: "M".repeat(30), line: "curious", asleep: false }, lang: "zh", stage: "elder", chips: { then: "x".repeat(80), when: Array.from({ length: 9 }, () => "y".repeat(70)) }, meters: { food: 0, joy: 1000, energy: 500, clean: 999 }, tapped: true });
    expect(schema.VoiceBody.parse(body)).toMatchObject({ name: "M".repeat(24), decision: "x".repeat(60), because: Array.from({ length: 6 }, () => "y".repeat(60)), sick: false, moment: "petted" });
    expect(req.voiceBody({ pet: { name: "M", line: "gentle", asleep: true, sick: true }, lang: "en", stage: "baby", chips: { then: "", when: [] }, meters: { food: 1, joy: 1, energy: 1, clean: 1 }, tapped: false })).toMatchObject({ decision: "rest", sick: true, moment: "decided" });
  });

  it("pet-sitting, the arena and the season", () => {
    expect(schema.SitLeaveBody.safeParse(req.sitLeaveBody("{}", "ab", Date.now())).success).toBe(true);
    expect(schema.SitHomeBody.safeParse(req.sitHomeBody("k", "{}")).success).toBe(true);
    expect(schema.ArenaSnapshotBody.safeParse(req.arenaSnapshotBody(3, pet, ["pip"], "d".repeat(32))).success).toBe(true);
    const opponent = req.withQuery("/api/arena/opponent", req.arenaOpponentQuery(3, "d".repeat(32)));
    expect(opponent).toBe(`/api/arena/opponent?round=3&device=${"d".repeat(32)}`);
    expect(schema.ArenaOpponentQuery.parse(queryOf(opponent))).toEqual({ round: 3, device: "d".repeat(32) });
    expect(req.seasonEnterBody(pet, "d".repeat(32))).toEqual({ pet, device: "d".repeat(32) });
    expect(schema.SeasonEnterBody.safeParse(req.seasonEnterBody(pet, "d".repeat(32))).success).toBe(true);
  });

  it("a shared lesson: its structure only, never the player's label, under a name of 24 characters", () => {
    const body = req.lessonShareBody(rule, "N".repeat(30));
    expect(body).toEqual({ rule: { when: rule.when, then: rule.then }, by: "N".repeat(24) });
    expect(schema.LessonShareBody.safeParse(body).success).toBe(true);
    expect(schema.LessonKeyBody.safeParse(req.lessonKeyBody("0123456789abcdef01234567")).success).toBe(true);
  });

  it("a diary, a move and a reminder plan", () => {
    expect(schema.PublishedLog.safeParse(req.diaryBody("4", [1, 2, 3], [{ brainId: "30", words: [1] }, { brainId: null, words: [2, 3] }])).success).toBe(true);
    expect(schema.MoveBody.safeParse(req.moveBody({ "lingxi.pets.v2": "[]", "lingxi.world.v1": "{}" })).success).toBe(true);
    const plan = req.pushPlanBody({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) } }, "en", "P".repeat(30), -300, [{ kind: "bored", at: 1_700_000_000_000 }]);
    expect(plan.name).toBe("P".repeat(24));
    expect(schema.PushPlanBody.safeParse(plan).success).toBe(true);
    expect(schema.PushStopBody.safeParse(req.pushStopBody("https://fcm.googleapis.com/fcm/send/x")).success).toBe(true);
  });

  it("goals and vouchers, as the server reads their queries", () => {
    expect(req.withQuery("/api/goals", req.goalsQuery([]))).toBe("/api/goals");
    const both = req.withQuery("/api/goals", req.goalsQuery([WALLET, WALLET.replace("ab", "cd")]));
    expect(schema.GoalsQuery.parse(queryOf(both)).wallet).toEqual([WALLET, WALLET.replace("ab", "cd")]);
    const voucher = req.withQuery("/api/voucher", req.voucherQuery(WALLET, "g1"));
    expect(voucher).toBe(`/api/voucher?wallet=${WALLET}&goal=g1`);
    expect(schema.VoucherQuery.parse(queryOf(voucher))).toEqual({ wallet: WALLET, goal: "g1" });
  });

  it("adoption papers", () => {
    expect(schema.PapersBody.safeParse(req.papersBody(JSON.stringify({ v: 1 }), SIG)).success).toBe(true);
  });

  it("the agents' page sparring demo", () => {
    const url = req.withQuery("/api/v1/spar", { chips: "punish,block,bite", vs: "pip", seed: "7" } satisfies schema.SparQuery);
    expect(schema.SparQuery.parse(queryOf(url))).toEqual({ chips: "punish,block,bite", vs: "pip", seed: "7" });
  });
});
