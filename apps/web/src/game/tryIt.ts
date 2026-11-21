/**
 * H5: the "try it" moment. Right after a lesson is taught, the game stages that lesson's situation on the pet's real
 * mind (its memory exactly as it is; nothing changes and nothing is logged) and the room shows, for a few seconds, what
 * the pet does and which rule decided. A lesson that waits on a memory the pet does not have yet says so.
 */

import { create } from "zustand";
import { INPUT_FIELDS, type Program, type Rule, type Senses, encodeSenses, runBeat, stateBits } from "@lingxi/brain";
import { now as gameNow } from "./gameClock";
import { useVoice } from "./voice";

/** A calm, watched daytime moment: nothing pressing, the owner here. */
const CALM: Senses = { hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 1 };

/** How long the room shows the staged moment. */
export const TRIAL_MS = 6000;

/** The situation a lesson names, with every sense it does not name calm and watched. */
export function stageFor(rule: Rule): Senses {
  const s: Senses = { ...CALM };
  for (const f of INPUT_FIELDS) {
    const allowed = (rule.when as Record<string, number[] | undefined>)[f.name];
    if (allowed?.length && !allowed.includes(s[f.name])) s[f.name] = allowed[0]!;
  }
  return s;
}

export interface Trial {
  /** what the pet chose, and in what mood */
  want: number;
  mood: number;
  /** the rule that decided (its place in the program), or -1 for its default */
  rule: number;
  /** whether the lesson itself decided */
  fired: boolean;
}

/** What the pet's mind does in the lesson's situation, from its memory as it is. */
export function tryLesson(program: Program, state: readonly number[], lesson: Rule): Trial {
  const word = encodeSenses(stageFor(lesson));
  const r = runBeat(program, state.slice(0, stateBits(program)), word);
  const at = program.rules.findIndex((x) => JSON.stringify([x.when, x.then]) === JSON.stringify([lesson.when, lesson.then]));
  const decided = r.rule >= 0 ? program.rules[r.rule]!.then : program.otherwise;
  return { want: decided.want, mood: decided.mood, rule: r.rule, fired: at >= 0 && r.rule === at };
}

interface TrialState {
  trial: (Trial & { at: number; lesson: Rule }) | null;
  /** stage a trial: the room shows it, the pet says `line`, and it ends by itself after TRIAL_MS */
  stage: (t: Trial, lesson: Rule, line: string) => void;
  end: () => void;
}

let ending: ReturnType<typeof setTimeout> | null = null;

export const useTrial = create<TrialState>((set) => ({
  trial: null,
  stage: (t, lesson, line) => {
    if (ending) clearTimeout(ending);
    set({ trial: { ...t, lesson, at: gameNow() } });
    // the pet's own words for it, set here: the voice service is never asked for a staged moment
    useVoice.setState((v) => ({ line, id: v.id + 1 }));
    ending = setTimeout(() => {
      ending = null;
      set({ trial: null });
    }, TRIAL_MS);
  },
  end: () => {
    if (ending) clearTimeout(ending);
    ending = null;
    set({ trial: null });
  },
}));
