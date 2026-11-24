/**
 * What this build can read under each save key whose loss would cost the player most (P1 S2). A save that parses but
 * fails its reader is held at start like one that will not parse, so a store never starts empty and writes over it.
 * Pure, so the old-save tests read the same rules the game does.
 */

import type { SaveReader } from "./save";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const anObject: SaveReader = (v) => (isObject(v) ? "ok" : "unreadable");
/** A save stamped with its version: a higher one than this build's was written by a newer Lingxi. */
const versioned =
  (version: number): SaveReader =>
  (v) =>
    !isObject(v)
      ? "unreadable"
      : v.version === version
        ? "ok"
        : typeof v.version === "number" && v.version > version
          ? "newer"
          : "unreadable";

/** The pet letters save (H13), stamped `v`: its identity's keys must be there, or the letters cannot be read. */
const letters: SaveReader = (v) =>
  !isObject(v)
    ? "unreadable"
    : v.v === 1 && typeof v.account === "string" && typeof v.privateKey === "string" && typeof v.secretKey === "string"
      ? "ok"
      : typeof v.v === "number" && v.v > 1
        ? "newer"
        : "unreadable";

export const READERS: Readonly<Record<string, SaveReader>> = {
  "lingxi.pets.v2": (v) => (isObject(v) && Array.isArray(v.pets) ? "ok" : "unreadable"),
  "lingxi.world.v1": versioned(1),
  "lingxi.chain.v2": anObject,
  "lingxi.friends.v1": anObject,
  "lingxi.mail.v1": anObject,
  "lingxi.badges.v1": anObject,
  "lingxi.daily.v1": anObject,
  "lingxi.care.v1": anObject,
  "lingxi.letters.v1": letters,
};
