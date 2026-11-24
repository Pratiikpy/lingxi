/**
 * What an error says, whatever was thrown (A21). A wallet may reject with a bare string ("User denied account access")
 * or with nothing at all, and reading `(e as Error).message` of those throws inside the catch: the chain panel was left
 * on "connecting" with every button disabled. Every catch in the game reads its error through these, which never throw.
 */

/** Everything an error says: a string as it is, an object's message, else what it is written as ("" for nothing). */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e === undefined || e === null) return "";
  const message = typeof e === "object" ? (e as { message?: unknown }).message : undefined;
  if (typeof message === "string") return message;
  if (typeof e !== "object") return String(e);
  try {
    return JSON.stringify(e);
  } catch {
    // an object that refers to itself
    return String(e);
  }
}

/** The first line of what an error says, trimmed, for showing to the player; `fallback` when it says nothing. */
export const firstLine = (e: unknown, fallback = "failed"): string =>
  errorText(e).split(/\r?\n/)[0]!.trim() || fallback;
