/**
 * Sparring partners: named pets with their own small brains, written in the
 * same rule language as a player's pet and read through the same fight pins
 * (see spar.ts). Each teaches something by beating you a particular way.
 */

import { type Program, validateProgram } from "@lingxi/brain";

export interface Partner {
  id: string;
  name: { en: string; zh: string };
  line: "gentle" | "bold" | "curious";
  stage: "baby" | "child" | "teen" | "adult";
  level: number;
  blurb: { en: string; zh: string };
  program: Program;
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
