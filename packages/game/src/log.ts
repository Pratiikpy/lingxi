/**
 * The input log a checkpoint commits to. Each beat's 16-bit input word is folded
 * into a keccak-256 chain exactly as PetRegistry.chainLog does on chain:
 *   h' = keccak256(abi.encodePacked(bytes32 h, uint16 word))
 */

import { keccak_256 } from "@noble/hashes/sha3";

export const ZERO_HASH = `0x${"00".repeat(32)}`;

function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length !== 64) throw new Error("hash must be 32 bytes");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function toHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function chainLog(h: string, word: number): string {
  if (!Number.isInteger(word) || word < 0 || word > 0xffff) throw new Error("word must be 16 bits");
  const buf = new Uint8Array(34);
  buf.set(hexToBytes(h), 0);
  buf[32] = (word >> 8) & 0xff;
  buf[33] = word & 0xff;
  return toHex(keccak_256(buf));
}

export function chainAll(h: string, words: readonly number[]): string {
  let x = h;
  for (const w of words) x = chainLog(x, w);
  return x;
}
