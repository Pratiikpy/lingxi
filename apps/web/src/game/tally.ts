/**
 * The pet's events reach the player's tally (plan 4.1) through here: the game store, the chain store and the
 * spar and gift screens call `noteTally`, and the world store, which owns the tally, takes them. Events noted before
 * the world store exists wait in order, so nothing is lost at start-up. `total: false` records a finer key of an
 * event already counted (CARE:feed-morning beside CARE:feed), so the type's total is not counted twice.
 */

type Opts = { total?: boolean };
type Sink = (type: string, index: number | string, n: number, opts: Opts) => void;

let sink: Sink | null = null;
const waiting: Array<[string, number | string, number, Opts]> = [];

export function noteTally(type: string, index: number | string = 0, n = 1, opts: Opts = {}): void {
  if (sink) sink(type, index, n, opts);
  else waiting.push([type, index, n, opts]);
}

/** A one-off event by name (it must be in the world package's EVENTS list). */
export const noteEvent = (name: string): void => noteTally("EVENT", name);

/** Lesson slots the player's quests have given (quest 65); the world store answers, the game store asks. */
let slotSource: () => number = () => 0;
export const setQuestSlots = (f: () => number): void => {
  slotSource = f;
};
export const questSlots = (): number => slotSource();

export function setTallySink(s: Sink): void {
  sink = s;
  for (const [type, index, n, opts] of waiting.splice(0)) s(type, index, n, opts);
}
