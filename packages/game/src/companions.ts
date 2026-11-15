/**
 * Arena companions (PRD A1, A2): small helpers who stand in line behind your
 * pet. Each has its own brain in the same rule language as a pet, read through
 * the same fight pins, and its strength comes from a balance table, never from
 * its brain (25-PRD B2): a brain only chooses what to do.
 *
 * Fight pins (team spar): hunger ← own health (0 full … 3 nearly out),
 * joy ← team momentum, energy ← stamina, clean ← enemy front's health (3 high),
 * time ← phase (1 opening, 2 middle, 3 late), action ← enemy front's last move,
 * event ← 3 hit hard · 2 enemy left an opening · 1 enemy was friendly.
 * Wants map to moves: 0 tap · 1 snack · 2 pounce · 3 rest · 4 dodge · 5 guard · 6 charm · 7 gift.
 */

import { type Program, validateProgram } from "@lingxi/brain";

export interface CompanionDef {
  id: string;
  name: { en: string; zh: string };
  role: { en: string; zh: string };
  /** body drawn from a pet line and stage, in its own palette */
  look: { line: "gentle" | "bold" | "curious"; stage: "baby" | "child" | "teen"; palette: "mint" | "lilac" | "peach" | "night" };
  /** balance table */
  hp: number;
  level: number;
  /** arena shop price */
  cost: number;
  program: Program;
}

const P = (rules: unknown[], otherwise: { want: number; mood: number }) => validateProgram({ version: "LX-PET/1", memory: [], rules, otherwise });

export const COMPANIONS: readonly CompanionDef[] = [
  {
    id: "sprig",
    name: { en: "Sprig", zh: "小枝" },
    role: { en: "Medic: heals the front of the line", zh: "医生：给队首回血" },
    look: { line: "gentle", stage: "baby", palette: "mint" },
    hp: 55,
    level: 0,
    cost: 3,
    program: P([{ when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } }, { when: { energy: [0] }, then: { want: 3, mood: 1 } }], { want: 7, mood: 2 }),
  },
  {
    id: "bolt",
    name: { en: "Bolt", zh: "小闪" },
    role: { en: "Striker: pounces while it has the energy", zh: "前锋：有力气就扑" },
    look: { line: "bold", stage: "child", palette: "peach" },
    hp: 70,
    level: 1,
    cost: 3,
    program: P([{ when: { energy: [0, 1] }, then: { want: 3, mood: 1 } }, { when: { event: [2] }, then: { want: 2, mood: 3 } }], { want: 2, mood: 2 }),
  },
  {
    id: "shell",
    name: { en: "Shell", zh: "硬壳" },
    role: { en: "Guard: braces when hit hard, hits back when the foe tires", zh: "守卫：被重击就防守，对手虚弱就反击" },
    look: { line: "bold", stage: "baby", palette: "night" },
    hp: 95,
    level: 0,
    cost: 3,
    program: P([{ when: { event: [3] }, then: { want: 5, mood: 1 } }, { when: { clean: [0, 1] }, then: { want: 2, mood: 2 } }, { when: { action: [2] }, then: { want: 5, mood: 1 } }], { want: 0, mood: 1 }),
  },
  {
    id: "wisp",
    name: { en: "Wisp", zh: "小雾" },
    role: { en: "Trickster: charms early, dodges pounces", zh: "捣蛋鬼：开场卖萌，躲开扑击" },
    look: { line: "curious", stage: "baby", palette: "lilac" },
    hp: 60,
    level: 0,
    cost: 3,
    program: P([{ when: { action: [2] }, then: { want: 4, mood: 2 } }, { when: { time: [1] }, then: { want: 6, mood: 2 } }, { when: { event: [2] }, then: { want: 2, mood: 2 } }], { want: 6, mood: 1 }),
  },
  {
    id: "ember",
    name: { en: "Ember", zh: "小焰" },
    role: { en: "Finisher: holds back, then goes all in late", zh: "收尾手：先忍，尾声全力出击" },
    look: { line: "gentle", stage: "child", palette: "peach" },
    hp: 65,
    level: 1,
    cost: 4,
    program: P([{ when: { time: [3] }, then: { want: 2, mood: 3 } }, { when: { clean: [0] }, then: { want: 2, mood: 3 } }, { when: { energy: [0, 1, 2] }, then: { want: 3, mood: 1 } }], { want: 5, mood: 1 }),
  },
  {
    id: "pebble",
    name: { en: "Pebble", zh: "小石" },
    role: { en: "Steady: taps every round, snacks when hurt", zh: "稳健：每回合轻拍，受伤就吃" },
    look: { line: "curious", stage: "child", palette: "mint" },
    hp: 80,
    level: 0,
    cost: 2,
    program: P([{ when: { hunger: [3] }, then: { want: 1, mood: 0 } }], { want: 0, mood: 1 }),
  },
  {
    id: "nova",
    name: { en: "Nova", zh: "新星" },
    role: { en: "Opportunist: strikes every opening, rests otherwise", zh: "机会主义：有破绽就打，否则休息" },
    look: { line: "curious", stage: "teen", palette: "night" },
    hp: 70,
    level: 2,
    cost: 5,
    program: P([{ when: { event: [2] }, then: { want: 2, mood: 3 } }, { when: { event: [1] }, then: { want: 2, mood: 2 } }, { when: { energy: [3] }, then: { want: 2, mood: 2 } }], { want: 3, mood: 1 }),
  },
  {
    id: "bloom",
    name: { en: "Bloom", zh: "绽放" },
    role: { en: "Kind: gifts to a friendly foe, guards the rest", zh: "善良：对友好的对手送礼，其余时候防守" },
    look: { line: "gentle", stage: "teen", palette: "lilac" },
    hp: 75,
    level: 1,
    cost: 4,
    program: P([{ when: { event: [1] }, then: { want: 7, mood: 3 } }, { when: { hunger: [2, 3] }, then: { want: 1, mood: 1 } }, { when: { event: [3] }, then: { want: 5, mood: 1 } }], { want: 7, mood: 2 }),
  },
];

export const COMPANION: Readonly<Record<string, CompanionDef>> = Object.fromEntries(COMPANIONS.map((c) => [c.id, c]));
