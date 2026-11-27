/**
 * What the game says when a friend's pet card cannot be used. A card the room could not keep (it keeps a bounded budget
 * of them, P10) is unavailable for now, and said so: never taken for a damaged card, or for a pet that cannot spar.
 */

/** When a friend's card has come and the pet cannot spar against it. */
export function cannotSparText(card: { unavailable?: boolean }, lang: string): string {
  if (card.unavailable)
    return lang === "zh"
      ? "现在取不到这只宠物的卡片，过一会儿再试试。"
      : "That pet's card isn't available right now. Try again in a little while.";
  return lang === "zh" ? "没法和这只宠物切磋" : "Can't spar with that pet";
}

/** When the other owner answered a family proposal and no little one can be planned. */
export function noFamilyText(
  answer: { name: string; yes: boolean; cardUnavailable?: boolean },
  partnerIsChild: boolean,
  lang: string,
): string {
  const zh = lang === "zh";
  if (!answer.yes) return zh ? `${answer.name}的主人说现在还不行。` : `${answer.name}'s owner said not now.`;
  if (answer.cardUnavailable)
    return zh
      ? `现在取不到${answer.name}的卡片，暂时没法一起养小宝宝，过一会儿再试试。`
      : `${answer.name}'s card isn't available right now, so no little one can be planned yet. Try again in a little while.`;
  if (partnerIsChild)
    return zh
      ? `${answer.name}是两只宠物的孩子，不能再养小宝宝。`
      : `${answer.name} was born of two parents, so it can't have little ones of its own.`;
  return zh ? "它们的心智没法拼在一起。" : "Their minds could not be put together.";
}
