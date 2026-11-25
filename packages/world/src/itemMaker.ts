/** One item, from its words in both languages, its kind, its use and price (P7: the table's maker, out of items.ts). */
import type { ItemDef, ItemKind } from "./items";

export const I = (
  en: string,
  zh: string,
  den: string,
  dzh: string,
  kind: ItemKind,
  use?: ItemDef["use"],
  price?: number,
  more: Partial<ItemDef> = {},
): ItemDef => ({
  name: { en, zh },
  desc: { en: den, zh: dzh },
  kind,
  ...(use ? { use } : {}),
  ...(price !== undefined ? { price } : {}),
  ...more,
});
