/**
 * Sparring partners: named pets with their own small brains, written in the
 * same rule language as a player's pet and read through the same fight pins
 * (see spar.ts). Each teaches something by beating you a particular way.
 */

import { type Program, type Rule, compileProgram, gateCount, validateProgram } from "@lingxi/brain";
import { MAX_GATES, composeProgram } from "./lessons";
import { halvesOf, parseCard } from "./family";
import type { Family } from "./pet";

export interface Partner {
  id: string;
  name: { en: string; zh: string };
  /** drawn as a fruit fly: a brain brought in from TapeFly's brawl */
  look?: "fly";
  line: "gentle" | "bold" | "curious";
  stage: "baby" | "child" | "teen" | "adult";
  level: number;
  blurb: { en: string; zh: string };
  program: Program;
  /** a friend's pet that was born of two parents fights with both halves of its mind */
  family?: Family;
  /** a friend's own taught lessons (needed with family to rebuild both halves) */
  lessons?: Rule[];
  /** a friend's instinct switches */
  instincts?: number;
  /** a friend's owned circuit, taught as an everyday instinct */
  outside?: import("./pet").OutsideInstinct;
}

const P = (rules: unknown[], otherwise: { want: number; mood: number }) => validateProgram({ version: "LX-PET/1", memory: [], rules, otherwise });

export const PARTNERS: readonly Partner[] = [
  {
    id: "plush",
    name: { en: "Plush", zh: "布偶" },
    line: "gentle",
    stage: "baby",
    level: 0,
    blurb: { en: "A soft practice partner. Mostly sits there.", zh: "软软的陪练布偶，大多数时候只是坐着。" },
    program: P([{ when: { hunger: [2, 3] }, then: { want: 1, mood: 0 } }, { when: { time: [3] }, then: { want: 0, mood: 0 } }], { want: 3, mood: 0 }),
  },
  {
    id: "pip",
    name: { en: "Pip the Pouncer", zh: "爱扑的皮皮" },
    line: "bold",
    stage: "child",
    level: 0,
    blurb: { en: "Pounces whenever it has the energy. Learn to guard.", zh: "一有力气就扑过来。学会防守吧。" },
    program: P([{ when: { energy: [0, 1] }, then: { want: 3, mood: 1 } }, { when: { time: [3] }, then: { want: 2, mood: 2 } }, { when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } }], { want: 2, mood: 1 }),
  },
  {
    id: "juniper",
    name: { en: "Juniper the Trickster", zh: "鬼灵精朱妮" },
    line: "curious",
    stage: "teen",
    level: 0,
    blurb: { en: "Charms you early, dodges your pounces, finishes you off.", zh: "开场先迷惑你，躲开你的扑击，最后收尾。" },
    program: P(
      [
        { when: { clean: [0, 1] }, then: { want: 2, mood: 3 } },
        { when: { action: [2] }, then: { want: 4, mood: 2 } },
        { when: { time: [0] }, then: { want: 6, mood: 2 } },
        { when: { energy: [0, 1] }, then: { want: 3, mood: 1 } },
        { when: { hunger: [3] }, then: { want: 1, mood: 1 } },
      ],
      { want: 2, mood: 2 },
    ),
  },
  {
    id: "mallow",
    name: { en: "Mallow the Wall", zh: "城墙棉花糖" },
    line: "gentle",
    stage: "adult",
    level: 1,
    blurb: { en: "Guards, waits for you to rest, then strikes.", zh: "先防守，等你休息时再出手。" },
    program: P(
      [
        { when: { event: [3] }, then: { want: 5, mood: 1 } },
        { when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } },
        { when: { event: [2] }, then: { want: 2, mood: 3 } },
        { when: { energy: [0] }, then: { want: 3, mood: 1 } },
        { when: { joy: [0], energy: [2, 3] }, then: { want: 2, mood: 2 } },
      ],
      { want: 5, mood: 1 },
    ),
  },
];

const STAGES = ["baby", "child", "teen", "adult"] as const;

/**
 * A friend's pet as a sparring partner, from the card shared in a live room.
 * Everything in the card is untrusted: the lessons must validate as a program
 * and compile within the brain's size budget, or there is no spar.
 */
export function friendPartner(card: { id: string; name: string; line: string; stage: string; lessons: string }): Partner | null {
  const line = (["gentle", "bold", "curious"] as const).find((l) => l === card.line);
  const parsed = parseCard(card.lessons);
  if (!line || !parsed) return null;
  try {
    const program = composeProgram(line, parsed.lessons, parsed.instincts);
    const minds = parsed.family ? halvesOf(parsed.family, parsed.lessons) : [program];
    for (const m of minds) if (gateCount(compileProgram(m)) > MAX_GATES) return null;
    const grown = card.stage === "elder" ? "adult" : card.stage;
    const stage = STAGES.find((s) => s === grown) ?? "baby";
    const name = card.name.slice(0, 12) || "Friend";
    return {
      id: `friend:${card.id}`,
      name: { en: name, zh: name },
      line,
      stage,
      level: card.stage === "elder" ? 2 : stage === "teen" || stage === "adult" ? 1 : 0,
      blurb: { en: `${name}'s real brain, with everything it has been taught.`, zh: `${name}真实的大脑，带着它学过的一切。` },
      program,
      lessons: parsed.lessons,
      ...(parsed.instincts ? { instincts: parsed.instincts } : {}),
      ...(parsed.family ? { family: parsed.family } : {}),
      ...(parsed.outside ? { outside: parsed.outside } : {}),
    };
  } catch {
    return null;
  }
}
