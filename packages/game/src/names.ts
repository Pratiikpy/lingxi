/**
 * Names hatched from the brain's own code (PRD F14, after TapeFly). The default
 * name is read from a hash of the pet's actual circuit, so a different egg or a
 * different instinct switch gives a different name; `draw` picks another name
 * from the same circuit. The player can always type their own and claim it on
 * chain later.
 */

import { keccak_256 } from "@noble/hashes/sha3";

const EN_START = ["Mo", "Pi", "Ko", "Lu", "Na", "Bo", "Ri", "Su", "Ta", "Mi", "Po", "Ki", "Nu", "Ra", "Fi", "Yu"] as const;
const EN_MID = ["chi", "po", "ri", "ko", "na", "mi", "lu", "bi", "ta", "su", "ni", "pa", "do", "ke", "mu", "le"] as const;
const EN_END = ["", "", "", "n", "s", "ko", "bo", "li"] as const;
const ZH = ["团", "糖", "豆", "圆", "桃", "米", "球", "布", "丁", "麻", "薯", "果", "奶", "泡", "芝", "糯", "云", "星", "毛", "芽", "栗", "柚", "酥", "雪", "橙", "汤", "饼", "棉", "梨", "卷", "铃", "莓"] as const;

export interface BrainName {
  en: string;
  zh: string;
  /** the first bytes of the hash the name was read from */
  from: string;
}

/** The name read from a circuit's bytes; `draw` 0 is its first name, 1 its next, and so on. */
export function nameFromBrain(netlist: Uint8Array, draw = 0): BrainName {
  const salt = new Uint8Array(netlist.length + 4);
  salt.set(netlist, 0);
  new DataView(salt.buffer).setUint32(netlist.length, draw >>> 0);
  const d = keccak_256(salt);
  const byte = (i: number) => d[i]!;
  const h = "0x" + Array.from(d.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
  const en = EN_START[byte(0) & 15]! + EN_MID[byte(1) & 15]! + EN_END[byte(2) & 7]!;
  const first = ZH[byte(3) & 31]!;
  const second = ZH[byte(4) & 31]!;
  // a doubled character reads as a pet name in Chinese (团团); otherwise two different ones
  const zh = byte(5) & 1 ? first + first : first + (second === first ? ZH[(byte(4) + 1) & 31]! : second);
  return { en, zh, from: h };
}
