/**
 * A resident's greeting now (plan 4.11): their circuit picks the mood and the line from what is true at this moment.
 */

import { CHARACTERS, type Line } from "./characters";
import { trustLevel } from "./conditions";
import { FOLK_BY_ID, type FolkView, folkWord } from "./folk";
import { friendsOf, trustOf } from "./friendship";
import { folkAnswer } from "./rules";
import type { WorldState } from "./world";
import { timeOfDay } from "@lingxi/brain";

export interface GreetingNow {
  lines: Line[];
  mood: number;
  slot: number;
}

const GIFT_CODE = { love: 1, like: 1, neutral: 2, dislike: 3 } as const;

/** What the circuit reads for a resident: the hour, trust, today's gift, the pet and whether a quest of theirs is ready. */
export function folkViewOf(
  w: WorldState,
  id: string,
  at: { hour: number; day: string; petHappy: boolean; petHungry: boolean; questReady: boolean },
): FolkView {
  const g = friendsOf(w).lastGift?.[id];
  return {
    timeOfDay: timeOfDay(at.hour),
    trustLevel: trustLevel(trustOf(w, id)),
    giftToday: g && g.day === at.day ? GIFT_CODE[g.taste] : 0,
    petHappy: at.petHappy,
    petHungry: at.petHungry,
    questReady: at.questReady,
  };
}

/** The resident's greeting: their usual hello for slot 0, else the line for the moment; the first face shows the mood. */
export function greetingNow(id: string, view: FolkView): GreetingNow | null {
  const who = CHARACTERS.find((c) => c.id === id);
  const folk = FOLK_BY_ID[id];
  const a = folkAnswer(id, folkWord(view));
  if (!who || !folk || !a) return null;
  const chosen = a.slot === 0 ? who.greeting : [folk.lines[a.slot as 1 | 2 | 3 | 4 | 5 | 6 | 7]];
  const lines = chosen.map((l, i) => (i === 0 ? { ...l, face: folk.faces[a.mood]! } : l));
  return { lines, mood: a.mood, slot: a.slot };
}
