/**
 * P10: what a structure holds, for the tests that bound a store's memory. A full collection is reached the way a test
 * may (the flag set now, the function taken from a fresh context), and the event loop is let turn between collections,
 * so what waits on a finalizer is not counted as kept. The structure measured must still be held when the second
 * reading is taken: `held` returns it, and the caller keeps using it after.
 */
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

/** The heap and the buffers outside it, collected with the event loop let turn. */
export async function heldNow(): Promise<number> {
  for (let i = 0; i < 3; i++) {
    gc();
    await new Promise((r) => setTimeout(r, 10));
  }
  gc();
  gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
}

/** The bytes `fill` makes `held` keep, over `n` things: [bytes each, what `held` returned]. */
export async function bytesEach<T>(
  n: number,
  held: () => T,
  fill: (it: T) => void | Promise<void>,
): Promise<[number, T]> {
  const it = held();
  const before = await heldNow();
  await fill(it);
  const after = await heldNow();
  return [(after - before) / n, it];
}
