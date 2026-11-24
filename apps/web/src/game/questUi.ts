/**
 * The quest toasts and the open quest card: a small store of its own, so the community goals can raise a toast
 * without importing the quests module that imports them (P7: goals > quests > goals was a cycle).
 */
import { create } from "zustand";
import type { Reward } from "@lingxi/world";

export interface QuestNote {
  id: number;
  quest: string;
  /** a quest that opened, became ready or was handed in; or a community goal with something to take (quest = goal id) */
  kind: "new" | "ready" | "done" | "goal";
  rewards?: readonly Reward[];
}

interface QuestUi {
  /** a quest that just opened, became ready, or was handed in: one toast at a time, the rest wait their turn */
  note: QuestNote | null;
  queue: QuestNote[];
  push: (n: Omit<QuestNote, "id">) => void;
  dismiss: () => void;
  /** the quest whose card is open from the pet's bubble or the book */
  open: string | null;
  setOpen: (id: string | null) => void;
  /** the book's tab to show when it next opens (a goal's toast opens Together) */
  bookTab: "story" | "today" | "together" | "milestones" | null;
  setBookTab: (t: QuestUi["bookTab"]) => void;
}

let noteId = 0;
export const useQuestUi = create<QuestUi>((set, get) => ({
  note: null,
  queue: [],
  push: (n) => {
    const next = { ...n, id: ++noteId };
    if (get().note) set({ queue: [...get().queue, next].slice(-4) });
    else set({ note: next });
  },
  dismiss: () => {
    const [head, ...rest] = get().queue;
    set({ note: head ?? null, queue: rest });
  },
  open: null,
  setOpen: (open) => set({ open }),
  bookTab: null,
  setBookTab: (bookTab) => set({ bookTab }),
}));
