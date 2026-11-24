/**
 * Names this project must never carry: the game it grew from, and the residents' names in that game.
 * They are kept as SHA-256 hashes (first 16 hex digits) so that the guard itself never spells them.
 *
 * Two kinds of match:
 *   - a substring, for words distinctive enough to catch inside identifiers and file names;
 *   - a whole token (split on anything that is not a letter or digit, on camelCase and on digits), for short
 *     words that also occur inside ordinary English.
 *
 * Used by `pnpm status:check` over tracked files and commit messages, by the web build over its output, and by the
 * tests over every shipped line. Not exported from the package: nothing in the game itself needs it.
 */

import { createHash } from "node:crypto";

/** [length in code points, hash] */
const SUBSTRINGS: ReadonlyArray<readonly [number, string]> = [
  [4, "2ed9585aa91fd80e"],
  [4, "f505b0d0f08d3f94"],
  [6, "b440f5af5438734a"],
  [6, "b9aa3c596e6a3474"],
  [8, "3c2f6915a3abc7e1"],
  [8, "ee1fd0664356d402"],
  [7, "94b5f0fa59e95858"],
  [3, "6f7b0c2c807d1419"],
  [2, "f74168ed3576eec7"],
  [3, "54ae26d54889afdb"],
  [2, "e33716be735e7af6"],
  [3, "7656dae1f4378e28"],
  [2, "5e4a473231ac0f61"],
  [4, "9d351382545aa458"],
];
const TOKENS = new Set([
  "9bb840df7f699d65",
  "84313ef39b0a979f",
  "2b5998a8611fae51",
  "4bc0edfe86e36c02",
  "6ab84705e5d695ef",
  "f818afa52287db76",
  "47acf82a48cfa5c3",
  "870051a4cdc4cda1",
]);

const hash = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
const BY_LENGTH = new Map<number, Set<string>>();
for (const [n, h] of SUBSTRINGS) BY_LENGTH.set(n, (BY_LENGTH.get(n) ?? new Set()).add(h));
const LENGTHS = [...BY_LENGTH.keys()].sort((a, b) => a - b);

/** hashes of every banned substring's first two code points: a cheap gate before the longer windows */
const PREFIXES = new Set([
  "3ebb1c99b12b7746",
  "19503ea6785ee124",
  "6351825030155836",
  "33129567e0bd787e",
  "225ed6562f6887b1",
  "ac0b52a2ae6ef999",
  "e4107ae79a5e3acb",
  "f74168ed3576eec7",
  "88c40923c1ae5344",
  "e33716be735e7af6",
  "dabe85c8ec1d427b",
  "5e4a473231ac0f61",
  "2c03a8c2af9d1533",
]);
/** two code points take few distinct values, so their verdicts are remembered */
const seenPrefix = new Map<string, boolean>();
function prefixBanned(pair: string): boolean {
  let hit = seenPrefix.get(pair);
  if (hit === undefined) {
    hit = PREFIXES.has(hash(pair));
    seenPrefix.set(pair, hit);
  }
  return hit;
}
function banned(window: string, n: number): boolean {
  return BY_LENGTH.get(n)!.has(hash(window));
}

const seenToken = new Map<string, boolean>();
function bannedToken(token: string): boolean {
  let hit = seenToken.get(token);
  if (hit === undefined) {
    hit = TOKENS.has(hash(token));
    seenToken.set(token, hit);
  }
  return hit;
}

export interface Hit {
  /** 1-based line of the match */
  line: number;
  /** the line around it, with the match masked, so a report does not spell it either */
  context: string;
}

function mask(line: string, from: number, length: number): string {
  const cps = [...line];
  const start = Math.max(0, from - 30);
  return (
    cps.slice(start, from).join("") +
    "•".repeat(length) +
    cps.slice(from + length, from + length + 30).join("")
  ).trim();
}

/** Every banned name in `text`, at most `limit` of them. */
export function scanNames(text: string, limit = 20): Hit[] {
  const hits: Hit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length && hits.length < limit; i++) {
    const line = lines[i]!;
    const cps = [...line.toLowerCase()];
    let found = false;
    for (let at = 0; at + 1 < cps.length && !found; at++) {
      if (!prefixBanned(cps[at]! + cps[at + 1]!)) continue;
      for (const n of LENGTHS) {
        if (at + n > cps.length) break;
        if (banned(cps.slice(at, at + n).join(""), n)) {
          hits.push({ line: i + 1, context: mask(line, at, n) });
          found = true;
          break;
        }
      }
    }
    if (found) continue;
    for (const raw of line.split(/[^\p{L}\p{N}]+/u)) {
      const parts = raw.split(/(?<=[a-z])(?=[A-Z])|(?<=\D)(?=\d)|(?<=\d)(?=\D)/);
      const hit = parts.find((p) => p && bannedToken(p.toLowerCase()));
      if (hit) {
        const at = [...line].join("").indexOf(hit);
        hits.push({ line: i + 1, context: mask(line, [...line.slice(0, Math.max(0, at))].length, [...hit].length) });
        break;
      }
    }
  }
  return hits;
}

/** Whether a single name (a file name, a path, a word) carries a banned name. */
export function hasBannedName(name: string): boolean {
  return scanNames(name, 1).length > 0;
}
