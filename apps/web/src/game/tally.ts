/**
 * The pet's events reach the player's tally (plan 4.1) through here: the game store, the chain store and the
 * spar and gift screens call `noteTally`, and the world store, which owns the tally, takes them. Events noted before
 * the world store exists wait in order, so nothing is lost at start-up.
 */

type Sink = (type: string, index: number | string, n: number) => void;

let sink: Sink | null = null;
const waiting: Array<[string, number | string, number]> = [];

export function noteTally(type: string, index: number | string = 0, n = 1): void {
  if (sink) sink(type, index, n);
  else waiting.push([type, index, n]);
}

export function setTallySink(s: Sink): void {
  sink = s;
  for (const [type, index, n] of waiting.splice(0)) s(type, index, n);
}
