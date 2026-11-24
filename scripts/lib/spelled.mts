/**
 * Counts as the landing spells them, so a claims check can hold a spelled-out number ("Seventy places", "七十个地方")
 * to the count it stands for (A110). Covers 1 to 99, which is every count the landing spells.
 */

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ZH = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function inRange(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new RangeError(`${n} is outside 1 to 99`);
}

/** "seventy", "twenty-five", "twelve". */
export function englishCount(n: number): string {
  inRange(n);
  if (n < 20) return ONES[n]!;
  const t = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

/** "七十", "二十五", "十二". */
export function chineseCount(n: number): string {
  inRange(n);
  const t = Math.floor(n / 10);
  const tens = t === 0 ? "" : t === 1 ? "十" : `${ZH[t]}十`;
  return tens + ZH[n % 10];
}
