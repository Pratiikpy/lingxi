/**
 * Pet letters over TapeRelay (H13): the parts the game and the server share. A player's relay identity is a TapeRelay
 * user identity (`key:0x<address>@relayN.taperelay.com`, made in their browser, no wallet); the server passes such an
 * address on in a room's presence only in its exact form. A letter is sealed and signed by the relay client; inside it,
 * this module's small form: one pet writing to one pet, at most PET_LETTER_MAX characters.
 */

import { shownName } from "./names";

/** The five official TapeRelay nodes, run by the TapeOut team during its test. */
export const RELAY_NODES = ["relay1.taperelay.com", "relay2.taperelay.com", "relay3.taperelay.com", "relay4.taperelay.com", "relay5.taperelay.com"] as const;

/** The longest letter, in characters (a letter must fit the relay's small sealed body of about 2,870 bytes). */
export const PET_LETTER_MAX = 600;
/** The form version inside a letter. */
const LETTER_FORM = 1;
/** A pet's name in a letter is shown as the game shows any name (A16). */
const NAME_MAX = 12;
const PLAYER_ID = /^[a-z0-9]{6,32}$/;

/**
 * A TapeRelay user identity on an official node: lower-case address, the node on port 443 (no port written, the one
 * most networks let through) or its own port 4246. Nothing else, so a room can never pass on a URL or a wrong host.
 */
const RELAY_ADDRESS = /^key:0x[0-9a-f]{40}@relay[1-5]\.taperelay\.com(?::4246)?$/;
export const isRelayAddress = (s: unknown): s is string => typeof s === "string" && RELAY_ADDRESS.test(s);

export interface Letter {
  from: { pet: string; player: string };
  toPet: string;
  text: string;
}

/** Characters as a reader counts them (an emoji is one). */
const chars = (s: string) => [...s].length;

/** A letter's body, or why it cannot be sent. */
export function writeLetter(l: Letter): { ok: true; body: string } | { ok: false; reason: "empty" | "tooLong" } {
  const text = l.text.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (chars(text) > PET_LETTER_MAX) return { ok: false, reason: "tooLong" };
  return { ok: true, body: JSON.stringify({ lx: LETTER_FORM, from: { pet: l.from.pet, player: l.from.player }, toPet: l.toPet, text }) };
}

/** A letter read back from a relay message that opened and verified: only in this form, names shown as the game shows them. */
export function readLetter(body: unknown): { ok: true; letter: Letter } | { ok: false } {
  let v: unknown;
  try {
    v = typeof body === "string" ? JSON.parse(body) : null;
  } catch {
    return { ok: false };
  }
  const o = v as { lx?: unknown; from?: { pet?: unknown; player?: unknown }; toPet?: unknown; text?: unknown } | null;
  if (!o || o.lx !== LETTER_FORM || typeof o.text !== "string" || typeof o.from?.pet !== "string" || typeof o.from.player !== "string" || typeof o.toPet !== "string") return { ok: false };
  const text = o.text.trim();
  if (!text || chars(text) > PET_LETTER_MAX || !PLAYER_ID.test(o.from.player)) return { ok: false };
  const pet = shownName(o.from.pet, NAME_MAX);
  const toPet = shownName(o.toPet, NAME_MAX);
  if (!pet || !toPet) return { ok: false };
  return { ok: true, letter: { from: { pet, player: o.from.player }, toPet, text } };
}
