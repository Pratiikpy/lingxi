/**
 * BEM amounts as people read and type them (8 decimals). A module of its own, with no imports, so a page that only
 * shows BEM (the live numbers page) loads these two functions and not the fashion market's contract code beside them
 * (R43); outfits.ts re-exports both, so every other reader is unchanged.
 */

/** Format BEM base units (8 decimals) without trailing zeros. */
export function formatBem(units: bigint): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Parse a BEM amount typed by a player ("0.25") into base units; null when it is not a valid amount. */
export function parseBem(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(t)) return null;
  const [w = "", f = ""] = t.split(".");
  return BigInt(w) * 100_000_000n + BigInt((f + "00000000").slice(0, 8));
}
