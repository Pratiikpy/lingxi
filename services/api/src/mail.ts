/**
 * In-game mail for events and updates (PRD S7). Letters to every player ship
 * with the server in mail/letters.json; each may carry a one-time gift that the
 * player's game adds to the bag. Letters without a valid shape are left out
 * rather than stopping the server.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

const Text = z.object({ en: z.string().min(1).max(2000), zh: z.string().min(1).max(2000) });
export const Letter = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  at: z.number().int().positive(),
  until: z.number().int().positive().optional(),
  subject: z.object({ en: z.string().min(1).max(120), zh: z.string().min(1).max(120) }),
  body: Text,
  gift: z.object({ item: z.number().int().positive(), n: z.number().int().min(1).max(20) }).optional(),
  /** a letter every newcomer should find unread, however long ago it was sent (the welcome, G8) */
  greets: z.boolean().optional(),
});
export type Letter = z.infer<typeof Letter>;

export function loadLetters(file: string): Letter[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stderr.write(`mail not loaded: ${(e as Error).message}\n`);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Letter[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const r = Letter.safeParse(item);
    if (r.success && !seen.has(r.data.id)) {
      seen.add(r.data.id);
      out.push(r.data);
    } else process.stderr.write(`mail: a letter was left out (${r.success ? "duplicate id" : r.error.issues[0]?.message})\n`);
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Letters current at a moment: sent already and not past their end. */
export const currentLetters = (letters: readonly Letter[], now: number): Letter[] => letters.filter((l) => l.at <= now && (!l.until || l.until > now));
