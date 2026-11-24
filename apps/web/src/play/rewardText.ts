/**
 * A quest's or a goal's reward in words, in the reader's language. Its own module, so the quest book and the
 * community goals can both name rewards without importing each other (P7: Quests > Goals > Quests was a cycle).
 */
import { wearableOf } from "@lingxi/art";
import { CHARACTERS, DECOR_BY_ID, ITEM, type Reward, TRAVEL_RECIPES } from "@lingxi/world";

type Lang = "en" | "zh";
const residentName = (id: string) => CHARACTERS.find((c) => c.id === id)?.name;

export function rewardText(r: Reward, lang: Lang): string | null {
  const zh = lang === "zh";
  switch (r.kind) {
    case "coins":
      return zh ? `${r.n} 金币` : `${r.n} coins`;
    case "item":
      return `${ITEM[r.item]?.name[lang] ?? r.item}${r.n > 1 ? ` ×${r.n}` : ""}`;
    case "trust":
      return zh ? `${residentName(r.who)?.zh ?? r.who}的信任 +${r.n}` : `+${r.n} trust with ${residentName(r.who)?.en ?? r.who}`;
    case "piece":
      return wearableOf(r.id)?.name[lang] ?? r.id;
    case "decor":
      return DECOR_BY_ID[r.id]?.name[lang] ?? r.id;
    case "recipe": {
      // named by what it makes, the way the quest's own lines talk about it
      const t = TRAVEL_RECIPES.find((x) => x.index === r.index);
      const made = t ? ITEM[t.out]?.name : undefined;
      return made ? (zh ? `配方：${made.zh}` : `Recipe: ${made.en}`) : null;
    }
    case "flag":
      return null; // a flag opens something in the story; the closing lines say what
  }
}
