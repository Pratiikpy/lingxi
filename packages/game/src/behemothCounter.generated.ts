/* Written by scripts/behemoth-counter.ts; re-run it to reproduce. Do not edit by hand. */

import type { Rule } from "@lingxi/brain";

/** Lessons a pet of this line can be taught to beat Behemoth, and the share of unseen spars they win. */
export const BEHEMOTH_COUNTER: { line: "gentle" | "bold" | "curious"; lessons: Rule[]; wins: number } = {"line":"gentle","lessons":[{"when":{"time":[2,3],"event":[3]},"then":{"want":2,"mood":2}},{"when":{"energy":[2]},"then":{"want":2,"mood":3}},{"when":{"action":[3,4]},"then":{"want":5,"mood":3}}],"wins":0.8};
