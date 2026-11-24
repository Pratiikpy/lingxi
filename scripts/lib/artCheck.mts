/**
 * Whether PetLook's installed palettes draw as meant (A17), read before the art is frozen for good. A palette is 16
 * colours of 4 bytes (RGBA); PetLook writes a see-through colour as `fill-opacity:.PP`, and alpha 254 writes
 * `fill-opacity:.:0`, which no browser reads.
 */
import { UNWRITABLE_ALPHA } from "../../packages/chain/src/look.ts";

export interface PaletteCheck {
  id: number;
  ok: boolean;
  problems: string[];
  /** the see-through colours, as role number and alpha */
  seeThrough: Array<{ role: number; alpha: number }>;
}

export function checkPalette(id: number, bytes: string): PaletteCheck {
  const raw = bytes.startsWith("0x") ? bytes.slice(2) : bytes;
  const problems: string[] = [];
  const seeThrough: PaletteCheck["seeThrough"] = [];
  if (raw.length !== 128) problems.push(raw.length === 0 ? "not installed" : `${raw.length / 2} bytes, not 64`);
  else
    for (let role = 1; role <= 16; role++) {
      const alpha = parseInt(raw.slice((role - 1) * 8 + 6, (role - 1) * 8 + 8), 16);
      if (alpha === UNWRITABLE_ALPHA)
        problems.push(`role ${role} has alpha ${UNWRITABLE_ALPHA}, written as broken CSS`);
      if (alpha !== 255) seeThrough.push({ role, alpha });
    }
  return { id, ok: problems.length === 0, problems, seeThrough };
}
