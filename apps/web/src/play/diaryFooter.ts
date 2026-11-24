/**
 * The line drawn at the foot of a shared diary image (A92). Only a pet kept on X Layer has its mind taped out there and
 * its saved days on chain to check; what holds for every pet is that its mind is a circuit you can read.
 */
export function diaryFooter(kept: boolean, lang: "en" | "zh"): string {
  if (kept)
    return lang === "zh"
      ? "灵犀 · 它的心智流片在 X Layer 上，存档的每一天都能在链上验证"
      : "Lingxi · its mind is taped out on X Layer, and its saved days can be checked there";
  return lang === "zh" ? "灵犀 · 一只心智是能读懂的电路的宠物" : "Lingxi · a pet whose mind is a circuit you can read";
}
