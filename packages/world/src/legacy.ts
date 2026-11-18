/**
 * Saves written before the residents were renamed (2026-11-18) carry their old ids and portrait file names: in
 * trust and friendship records, tallies such as `TALK:<id>` and `<id>:<item>`, step ids such as `<id>-s1`, and
 * portrait paths. This maps them to today's names so no friendship, gift or quest is lost.
 *
 * The old names are matched by a 53-bit hash (cyrb53), so the code that reads them never spells them.
 */

/** cyrb53 of an old name -> its new name */
const LEGACY = new Map<string, string>([
  ["1ft6pvd23", "wick"],
  ["37wl7uwkxu", "praline"],
  ["1qxzz783o9c", "yonder"],
  ["1hiyktm7gxj", "twain"],
  ["1lfgx817iyi", "bolt"],
  ["29a0f02edam", "flit"],
  ["68fec4pgad", "jab"],
  ["1arztg2pvr9", "nimbus"],
  ["1ptljr8tfnv", "coin_magnet.png"],
  ["nunaow5sra", "wick.png"],
  ["2gabhfi8iz7", "wick_clasping_hands.png"],
  ["2ajih7tvyez", "wick_happy.png"],
  ["1ph1cvsxnto", "wick_lost_in_thought.png"],
  ["3v95mbxrw2", "jab_default_1.png"],
  ["obdjvbf37k", "jab_scary_1.png"],
  ["4513oi7axo", "jab_shocked_1.png"],
  ["21ppv18hzf1", "jab_shrug_1.png"],
  ["2fxdcwc1yvx", "twain_both.png"],
  ["1b9p2ifdbx0", "twain_frown.png"],
  ["2ai6yu4hr00", "twain_laugh.png"],
  ["1pyfa6p8yu1", "yonder.png"],
  ["wtgw2etwg", "yonder_day.png"],
  ["zw8e65zus9", "yonder_night.png"],
  ["db35lcppos", "yonder_pose_2.png"],
  ["s801nerblo", "flit.png"],
  ["1lw2ne52m4q", "nimbus_daydreaming.png"],
  ["2ikl7d2r1j", "nimbus_default.png"],
  ["24reragr9ww", "nimbus_smiling.png"],
  ["1qcjfqacipo", "praline_default.png"],
  ["1d0ymdjrrbx", "praline_default_1.png"],
  ["14ym6nho2qy", "praline_laugh_1.png"],
  ["20ovxxr78ko", "praline_pity_1.png"],
  ["2b94jf2ivai", "bolt_clear1.png"],
  ["1be5610gskk", "bolt_clear2.png"],
  ["20u8l0e4l1s", "bolt_clear3.png"],
]);

/** Fields that hold the player's own words, never renamed. */
const OWN_WORDS = new Set(["name", "note", "message", "text"]);

export function cyrb53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A string with every old name in it, whole or as a part between `:`, `-` and `/`, replaced by today's. */
export function renameLegacyString(s: string): string {
  const whole = LEGACY.get(cyrb53(s));
  if (whole) return whole;
  if (!/[:/-]/.test(s)) return s;
  const parts = s.split(/([:/-])/);
  let changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const next = LEGACY.get(cyrb53(parts[i]!));
    if (next) {
      parts[i] = next;
      changed = true;
    }
  }
  return changed ? parts.join("") : s;
}

/** A saved value with every old resident id and portrait name renamed; the same object when nothing changed. */
export function renameLegacy<T>(value: T, key?: string): T {
  if (typeof value === "string") return (key && OWN_WORDS.has(key) ? value : renameLegacyString(value)) as T;
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const n = renameLegacy(v, key);
      if (n !== v) changed = true;
      return n;
    });
    return (changed ? out : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nk = renameLegacyString(k);
      const nv = renameLegacy(v, k);
      if (nk !== k || nv !== v) changed = true;
      out[nk] = nv;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
