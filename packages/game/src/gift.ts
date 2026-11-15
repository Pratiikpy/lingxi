/**
 * Gifts carried by pets (PRD Z2). A gift travels as a link: a short letter, an
 * egg that hatches into a sibling of the sender's pet (same line, carrying what
 * the sender taught it), and optionally one item. The whole gift lives in the
 * link's fragment, so it needs no server and no wallet, and the server never
 * sees it. Everything in a gift is untrusted when it arrives and is checked
 * before use.
 */

import { type Rule, b64urlDecode, b64urlEncode, compileProgram, gateCount } from "@lingxi/brain";
import { MAX_GATES, composeProgram } from "./lessons";

const PREFIX = "lxg1.";
export const LETTER_MAX = 200;
export const MAX_GIFT_CODE = 8_000;
const LINES = ["gentle", "bold", "curious"] as const;
type Line = (typeof LINES)[number];

export interface Gift {
  /** random id, so a device opens each gift once */
  id: string;
  from: { name: string; line: Line; stage: string };
  letter: string;
  egg?: { line: Line; lessons: Rule[] };
  item?: { id: number; n: number };
  /** when it was sent, ms */
  at: number;
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

export function encodeGift(g: Gift): string {
  return PREFIX + b64urlEncode(JSON.stringify(g));
}

export class GiftError extends Error {}

/** Reads a gift from a link. Anything malformed, oversized or impossible is refused. */
export function decodeGift(code: string): Gift {
  if (typeof code !== "string" || !code.startsWith(PREFIX)) throw new GiftError("not a Lingxi gift");
  if (code.length > MAX_GIFT_CODE) throw new GiftError("gift link is too long");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(b64urlDecode(code.slice(PREFIX.length))) as Record<string, unknown>;
  } catch {
    throw new GiftError("gift link is damaged");
  }
  const id = clean(raw.id, 32);
  if (!/^[a-z0-9]{8,32}$/.test(id)) throw new GiftError("gift has no id");
  const from = (raw.from ?? {}) as Record<string, unknown>;
  const fromLine = LINES.find((l) => l === from.line);
  if (!fromLine) throw new GiftError("unknown sender pet");
  const gift: Gift = {
    id,
    from: { name: clean(from.name, 12) || "A friend", line: fromLine, stage: clean(from.stage, 8) || "baby" },
    letter: clean(raw.letter, LETTER_MAX),
    at: Number.isFinite(raw.at) ? Math.max(0, Math.floor(raw.at as number)) : 0,
  };
  if (raw.egg !== undefined) {
    const egg = raw.egg as Record<string, unknown>;
    const line = LINES.find((l) => l === egg.line);
    if (!line || !Array.isArray(egg.lessons) || egg.lessons.length > 8) throw new GiftError("the egg is damaged");
    let gates: number;
    try {
      gates = gateCount(compileProgram(composeProgram(line, egg.lessons as Rule[])));
    } catch {
      throw new GiftError("the egg's mind does not fit together");
    }
    if (gates > MAX_GATES) throw new GiftError("the egg's mind is too big");
    gift.egg = { line, lessons: egg.lessons as Rule[] };
  }
  if (raw.item !== undefined) {
    const item = raw.item as Record<string, unknown>;
    if (!Number.isInteger(item.id) || !Number.isInteger(item.n) || (item.id as number) < 0 || (item.id as number) > 100_000 || (item.n as number) < 1 || (item.n as number) > 5) {
      throw new GiftError("the item is damaged");
    }
    gift.item = { id: item.id as number, n: item.n as number };
  }
  if (!gift.letter && !gift.egg && !gift.item) throw new GiftError("the gift is empty");
  return gift;
}

export function newGiftId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}
