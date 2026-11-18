/**
 * How much the game may send its server in one request: one list for both sides, so the game measures a body before
 * sending it and the player is told plainly, instead of meeting a refusal it could have seen coming (P1, from H3's
 * soak). Bodies are measured in bytes as sent (UTF-8); where the server counts characters or words, so does this.
 */

const KB = 1024;

export const SEND_LIMITS = {
  /** a whole game save moving to another device: the request, and the save's own text */
  moveBodyBytes: 4096 * KB,
  moveChars: 3_000_000,
  /** a pet left with a friend, or coming home from one: the request, and the pet's pack */
  sitBodyBytes: 700_000,
  sitPackChars: 600_000,
  /** a pet's published thought log: the request, and its words */
  logBodyBytes: 1536 * KB,
  logWords: 100_000,
} as const;

/** The bytes a text takes on the wire. */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A size as a person reads it: "1.4 MB", "640 KB". */
export const readableSize = (bytes: number): string => (bytes >= 1024 * KB ? `${(bytes / (1024 * KB)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / KB))} KB`);
