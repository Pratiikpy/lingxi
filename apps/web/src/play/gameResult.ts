/**
 * What the screen says after a game (G8): every game lifts the pet's joy, more for each star, so even a game with no
 * stars is fun for it, but only a good game is called a great time.
 */
export function resultLine(score: number, stars: number, name: string, lang: "en" | "zh"): string {
  if (lang === "zh") {
    const how =
      stars >= 3
        ? `${name}超爱这一局！`
        : stars === 2
          ? `${name}玩得很开心！`
          : stars === 1
            ? `${name}玩得挺开心。`
            : `不过${name}还是喜欢和你一起玩。`;
    return `得分 ${score}。${how}`;
  }
  const how =
    stars >= 3
      ? `${name} loved that one!`
      : stars === 2
        ? `${name} had a great time!`
        : stars === 1
          ? `${name} had fun.`
          : `${name} still liked playing with you.`;
  return `Score ${score}. ${how}`;
}
