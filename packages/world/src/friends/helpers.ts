/**
 * Building a friend's sheet: every friend has the same shape of seven steps over six levels. Step 1 at level 1,
 * step 2 at level 2, a branch at level 3 (3a or 3b, each shutting the other), step 4 at level 4 reached from
 * either branch, step 5 at level 5, step 6 at level 6.
 */

import type { FriendSheet, FriendStep, Taste, Unlock } from "../friendship";
import type { QuestLine, Text } from "../story";

type StepInput = { title: Text; lines: readonly QuestLine[]; unlock: Unlock; choice?: Text };

export interface FriendInput {
  id: string;
  kind: FriendSheet["kind"];
  likes: FriendSheet["likes"];
  reactions: Readonly<Record<Taste, QuestLine>>;
  steps: { s1: StepInput; s2: StepInput; s3a: StepInput & { choice: Text }; s3b: StepInput & { choice: Text }; s4: StepInput; s5: StepInput; s6: StepInput };
}

export function friend(f: FriendInput): FriendSheet {
  const id = (k: string) => `${f.id}-${k}`;
  const s = f.steps;
  const steps: FriendStep[] = [
    { id: id("1"), level: 1, ...s.s1 },
    { id: id("2"), level: 2, after: [id("1")], ...s.s2 },
    { id: id("3a"), level: 3, after: [id("2")], not: [id("3b")], ...s.s3a },
    { id: id("3b"), level: 3, after: [id("2")], not: [id("3a")], ...s.s3b },
    { id: id("4"), level: 4, after: [id("3a"), id("3b")], ...s.s4 },
    { id: id("5"), level: 5, after: [id("4")], ...s.s5 },
    { id: id("6"), level: 6, after: [id("5")], ...s.s6 },
  ];
  return { id: f.id, kind: f.kind, likes: f.likes, reactions: f.reactions, steps };
}

export const T = (en: string, zh: string): Text => ({ en, zh });
export const say = (face: string | undefined, en: string, zh: string): QuestLine => (face ? { face, en, zh } : { en, zh });
export const topic = (ask: Text, lines: Array<{ face: string; en: string; zh: string }>): Unlock => ({ kind: "topic", topic: { ask, lines } });
