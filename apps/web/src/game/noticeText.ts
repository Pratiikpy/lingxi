/**
 * A world notice (a find, a purchase, a refusal) in the player's words: kept apart from the world panels
 * (play/WorldPanels.tsx) so the game's notice lane does not load the map and bag screens with the game (P3).
 */
import { DECOR_BY_ID, ITEM } from "@lingxi/world";
import { WEARABLE } from "@lingxi/art";
import type { Key, useT } from "../i18n";
import type { WorldNotice } from "./world";

export function itemList(items: Array<{ item: number; n: number }> | undefined, lang: "en" | "zh"): string {
  return (items ?? []).map((x) => `${ITEM[x.item]?.name[lang] ?? "?"}${x.n > 1 ? ` ×${x.n}` : ""}`).join(lang === "zh" ? "、" : ", ");
}

export function noticeText(nt: WorldNotice, t: ReturnType<typeof useT>, lang: "en" | "zh"): string | null {
  if (nt.kind === "moved") {
    // Wanderer and Rich Finds (G6): the first entry today into this room picked something up
    const picked = nt.items?.length ? (lang === "zh" ? `进门时捡到了${itemList(nt.items, lang)}。` : `Picked up ${itemList(nt.items, lang)} on the way in.`) : "";
    const first = nt.coins ? t("world.firstVisit", { n: nt.coins }) : "";
    return [first, picked].filter(Boolean).join(lang === "zh" ? "" : " ") || null;
  }
  if (nt.kind === "found" && nt.secret)
    return lang === "zh" ? `找到了 ${itemList(nt.items, lang)}。这里越来越熟悉了，还发现了一样藏着的东西！` : `Found ${itemList(nt.items, lang)}. This place knows you now, and showed you something hidden!`;
  if (nt.kind === "found" && nt.text === "lucky")
    return lang === "zh" ? `找到了 ${itemList(nt.items, lang)}。今天是这里的幸运日，多找到了一样！` : `Found ${itemList(nt.items, lang)}. It's this room's lucky day: one more find!`;
  // D24: in the evening the lucky room's luck drifts home
  if (nt.kind === "found" && nt.text === "luckyHome")
    return lang === "zh" ? `找到了 ${itemList(nt.items, lang)}。今天的好运飘回了家，多找到了一样！` : `Found ${itemList(nt.items, lang)}. Today's luck drifted home: one more find!`;
  if (nt.kind === "found") return t("world.found", { items: itemList(nt.items, lang) });
  if (nt.kind === "readied") return lang === "zh" ? `${itemList(nt.items, lang)}准备好了，下次会用上。` : `${itemList(nt.items, lang)} is ready for next time.`;
  if (nt.kind === "made" && nt.xp) return lang === "zh" ? `做好了 ${itemList(nt.items, lang)}。经验 +${nt.xp}。` : `Made ${itemList(nt.items, lang)}. +${nt.xp} experience.`;
  if (nt.kind === "bought") return t("world.bought", { items: itemList(nt.items, lang) });
  if (nt.kind === "made") return t("world.made", { items: itemList(nt.items, lang) });
  if (nt.kind === "opened") return t("world.opened", { items: itemList(nt.items, lang) });
  if (nt.kind === "planted") return t("world.planted");
  if (nt.kind === "harvested") return t("world.harvested", { items: itemList(nt.items, lang) });
  if (nt.kind === "compost") return t("world.compost");
  if (nt.kind === "sewn") return lang === "zh" ? `新衣服：${WEARABLE[nt.text ?? ""]?.name.zh ?? ""}。去宠物页穿上吧。` : `New outfit: ${WEARABLE[nt.text ?? ""]?.name.en ?? ""}. Put it on from the pet page.`;
  if (nt.kind === "built") return lang === "zh" ? `做好了${DECOR_BY_ID[nt.text ?? ""]?.name.zh ?? ""}，可以摆在家里了。` : `Built a ${DECOR_BY_ID[nt.text ?? ""]?.name.en.toLowerCase() ?? ""} for the home.`;
  if (nt.kind === "claimed") return t("world.claimed", { coins: nt.coins ?? 0, items: nt.items?.length ? (lang === "zh" ? `，${itemList(nt.items, lang)}` : `, ${itemList(nt.items, lang)}`) : "" });
  const more: Record<string, [string, string]> = {
    tool: ["You need the right tool for that. Praline's Corner Shop sells them.", "需要合适的工具。糖霜的街角小店有卖。"],
    room: ["That can only be made in one special place.", "这个只能在一个特别的地方做。"],
    limit: ["Your pet has had as many of those as it ever can.", "这个宠物已经用到上限了。"],
    notABox: ["That doesn't open.", "这个打不开。"],
    none: ["You don't have one of those.", "你没有这个。"],
    stage: ["Your pet needs to grow up a little more for that.", "宠物还要再长大一些才行。"],
    allDug: ["Every plot is already dug.", "所有地块都已经开出来了。"],
  };
  const m = more[nt.reason ?? ""];
  if (m) return lang === "zh" ? m[1] : m[0];
  const k = `world.fail.${nt.reason}` as Key;
  return ["tired", "asleep", "already", "nothingHere", "coins", "missing", "notNear", "full", "owned", "notHere", "noSeed", "noCompost", "notRipe", "taken", "walking", "travelling", "notBack", "notSold", "notOwned", "wrongSlot"].includes(nt.reason ?? "") ? t(k) : t("world.fail.other");
}
