/**
 * A27: what a little one inherits, said before it is welcomed. A child's mind is its parents' whole minds as they are
 * at its birth (every lesson, the instincts, the capstone skills), since its circuit on chain is made of theirs; and a
 * child of well-taught parents may have no room to learn lessons of its own until it grows.
 */

type Lang = "en" | "zh";

/** "Kiri's 3 lessons", "Kiri's one lesson", "no lessons of Kiri's yet". */
function lessonsOf(name: string, n: number, lang: Lang): string {
  if (lang === "zh") return n === 0 ? `${name}还没学过的课` : `${name}的 ${n} 条课`;
  return n === 0 ? `no lessons of ${name}'s yet` : n === 1 ? `${name}'s one lesson` : `${name}'s ${n} lessons`;
}

/** The proposal's line about the player's own pet: which of its lessons go into the little one. */
export function proposalInherits(name: string, lessons: number, lang: Lang): string {
  if (lang === "zh") return lessons === 0 ? `${name}还没学过课；它的本能和技能会传给小宝宝。` : `${name}的 ${lessons} 条课都会传给小宝宝，还有它的本能和技能。`;
  if (lessons === 0) return `${name} hasn't learned a lesson yet; its instincts and skills go into the little one.`;
  return `${lessons === 1 ? `${name}'s one lesson goes` : `All ${lessons} of ${name}'s lessons go`} into the little one, with its instincts and skills.`;
}

/** The newborn's line: both parents' lessons, and whether it can learn yet (`room`, in gates; 0 or less is none). */
export function newbornInherits(a: { name: string; lessons: readonly unknown[] }, b: { name: string; lessons: readonly unknown[] }, room: number, lang: Lang): string {
  const both = `${lessonsOf(a.name, a.lessons.length, lang)}${lang === "zh" ? "、" : " and "}${lessonsOf(b.name, b.lessons.length, lang)}`;
  if (lang === "zh") return `它继承了父母完整的心智：${both}，还有它们的本能和技能。${room > 0 ? "你再教它的，两边都会学。" : "现在父母的心智把它装满了：等它长大一些，才有空间学自己的新课。"}`;
  return `It inherits both whole minds: ${both}, with their instincts and skills. ${room > 0 ? "Whatever you teach it, both halves learn." : "Their minds fill it for now: it can learn lessons of its own once it has grown."}`;
}
