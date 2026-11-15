/**
 * The starter brains a pet hatches with. Each egg line has its own temperament;
 * all three share the same pins and differ in their rules and memory.
 *
 * Value names for reading these: see src/pins.ts. In short,
 *   action 1 feed · 2 play · 3 clean · 4 lights off · 5 pet · 6 medicine · 7 talk
 *   event  1 friend near · 2 toy near · 3 something scary
 *   want   0 idle · 1 eat · 2 play · 3 sleep · 4 explore · 5 sulk · 6 cuddle · 7 share
 *   mood   0 grumpy · 1 calm · 2 happy · 3 excited
 *   nudge  1 brave · 2 curious · 3 greedy · 4 calm · 5 playful · 6 gentle · 7 shy
 */

import { type Program, validateProgram } from "./program";

const shared = {
  version: "LX-PET/1" as const,
  memory: [
    {
      name: "trust",
      label: "How much it trusts you",
      kind: "counter" as const,
      bits: 3,
      inc: [
        { action: [5], owner: [1] },
        { action: [1], hunger: [2, 3] },
        { action: [6] },
      ],
      dec: [{ hunger: [3], owner: [0] }, { clean: [0], owner: [0] }],
    },
    {
      name: "likesToys",
      label: "Remembers that toys are fun",
      kind: "flag" as const,
      set: [{ action: [2], joy: [2, 3] }],
      reset: [{ action: [2], joy: [0] }],
    },
    {
      name: "scared",
      label: "Still shaken by something scary",
      kind: "flag" as const,
      set: [{ event: [3] }],
      reset: [{ action: [5] }, { action: [7], owner: [1] }],
    },
    {
      name: "awake",
      label: "Beats since its last sleep",
      kind: "timer" as const,
      bits: 3,
      reset: [{ action: [4] }, { energy: [3] }],
    },
  ],
};

export const STARTER_GENTLE: Program = validateProgram({
  ...shared,
  rules: [
    { label: "frightened and unsure of you", when: { event: [3], trust: [0, 1, 2] }, then: { want: 5, mood: 0, nudge: 7 } },
    { label: "frightened, comes to you", when: { event: [3] }, then: { want: 6, mood: 1, nudge: 1 } },
    { label: "starving", when: { hunger: [3] }, then: { want: 1, mood: 0 } },
    { label: "worn out", when: { energy: [0] }, then: { want: 3, mood: 1 } },
    { label: "lights off", when: { action: [4] }, then: { want: 3, mood: 1, nudge: 4 } },
    { label: "up too long", when: { awake: [7], energy: [0, 1] }, then: { want: 3, mood: 0 } },
    { label: "fed when hungry", when: { action: [1], hunger: [2] }, then: { want: 1, mood: 2 } },
    { label: "still shaken", when: { scared: [1], owner: [1] }, then: { want: 6, mood: 1 } },
    { label: "shares with a friend", when: { event: [1], likesToys: [1], joy: [2, 3] }, then: { want: 7, mood: 2, nudge: 6 } },
    { label: "a toy!", when: { event: [2] }, then: { want: 2, mood: 3, nudge: 5 } },
    { label: "too dirty", when: { clean: [0] }, then: { want: 5, mood: 0 } },
    { label: "petted by someone it trusts", when: { action: [5], trust: [4, 5, 6, 7] }, then: { want: 6, mood: 2, nudge: 6 } },
    { label: "petted", when: { action: [5] }, then: { want: 0, mood: 1, nudge: 7 } },
    { label: "joyful with you", when: { owner: [1], joy: [3] }, then: { want: 2, mood: 3 } },
    { label: "night", when: { time: [0] }, then: { want: 3, mood: 1 } },
    { label: "bored in the day", when: { time: [2], joy: [0, 1], owner: [0] }, then: { want: 4, mood: 1, nudge: 2 } },
  ],
  otherwise: { want: 0, mood: 1 },
});

export const STARTER_BOLD: Program = validateProgram({
  ...shared,
  rules: [
    { label: "faces the scary thing", when: { event: [3] }, then: { want: 4, mood: 3, nudge: 1 } },
    { label: "starving", when: { hunger: [3] }, then: { want: 1, mood: 0, nudge: 3 } },
    { label: "worn out", when: { energy: [0] }, then: { want: 3, mood: 0 } },
    { label: "lights off", when: { action: [4] }, then: { want: 3, mood: 1 } },
    { label: "fed", when: { action: [1], hunger: [1, 2] }, then: { want: 1, mood: 2, nudge: 3 } },
    { label: "a toy!", when: { event: [2] }, then: { want: 2, mood: 3, nudge: 5 } },
    { label: "a friend to play with", when: { event: [1] }, then: { want: 2, mood: 3, nudge: 5 } },
    { label: "too dirty", when: { clean: [0] }, then: { want: 5, mood: 0 } },
    { label: "petted by a friend", when: { action: [5], trust: [3, 4, 5, 6, 7] }, then: { want: 6, mood: 2 } },
    { label: "restless", when: { energy: [2, 3], time: [1, 2] }, then: { want: 4, mood: 2, nudge: 2 } },
    { label: "night", when: { time: [0] }, then: { want: 3, mood: 1 } },
  ],
  otherwise: { want: 4, mood: 1 },
});

export const STARTER_CURIOUS: Program = validateProgram({
  ...shared,
  rules: [
    { label: "frightened", when: { event: [3], trust: [0, 1, 2, 3] }, then: { want: 5, mood: 0, nudge: 7 } },
    { label: "peeks at the scary thing", when: { event: [3] }, then: { want: 4, mood: 1, nudge: 2 } },
    { label: "starving", when: { hunger: [3] }, then: { want: 1, mood: 0 } },
    { label: "worn out", when: { energy: [0] }, then: { want: 3, mood: 1 } },
    { label: "lights off", when: { action: [4] }, then: { want: 3, mood: 1 } },
    { label: "talked to", when: { action: [7], owner: [1] }, then: { want: 6, mood: 2, nudge: 2 } },
    { label: "fed", when: { action: [1], hunger: [2] }, then: { want: 1, mood: 2 } },
    { label: "a toy to study", when: { event: [2] }, then: { want: 2, mood: 2, nudge: 2 } },
    { label: "meets a friend", when: { event: [1], likesToys: [1] }, then: { want: 7, mood: 2, nudge: 6 } },
    { label: "too dirty", when: { clean: [0] }, then: { want: 5, mood: 0 } },
    { label: "petted", when: { action: [5] }, then: { want: 6, mood: 2 } },
    { label: "wanders in the day", when: { time: [1, 2] }, then: { want: 4, mood: 2, nudge: 2 } },
    { label: "night", when: { time: [0] }, then: { want: 3, mood: 1 } },
  ],
  otherwise: { want: 0, mood: 1 },
});

export const STARTERS = { gentle: STARTER_GENTLE, bold: STARTER_BOLD, curious: STARTER_CURIOUS } as const;
export type StarterLine = keyof typeof STARTERS;
