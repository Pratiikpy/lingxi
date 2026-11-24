/**
 * Measures a request against the server's limits before it is sent (P1, from H3's soak: a moving save, a sitting
 * pack and a published log used to go out unmeasured and come back refused). The limits are the server's own list.
 */

import { SEND_LIMITS, readableSize, utf8Bytes } from "@lingxi/chain/limits";

export { SEND_LIMITS };

/** A request the server would refuse for its size: how big it is and the most allowed, in bytes or words. */
export class TooBig extends Error {
  constructor(
    readonly unit: "bytes" | "words",
    readonly have: number,
    readonly most: number,
  ) {
    super("tooBig");
    this.name = "TooBig";
  }
}

/** Throws TooBig when `body` is over `mostBytes`, or a count the server also checks is over its most. */
export function checkSize(
  body: string,
  mostBytes: number,
  also?: { unit: "bytes" | "words"; have: number; most: number },
): void {
  if (also && also.have > also.most) throw new TooBig(also.unit, also.have, also.most);
  const bytes = utf8Bytes(body);
  if (bytes > mostBytes) throw new TooBig("bytes", bytes, mostBytes);
}

/** "(1.4 MB; the most is 1.0 MB)" in the player's language. */
export function sizeNote(e: TooBig, lang: "en" | "zh"): string {
  const show = (n: number) =>
    e.unit === "bytes"
      ? readableSize(n)
      : lang === "zh"
        ? `${n.toLocaleString("zh-CN")} 个词`
        : `${n.toLocaleString("en")} words`;
  return lang === "zh" ? `（${show(e.have)}，最多 ${show(e.most)}）` : `(${show(e.have)}; the most is ${show(e.most)})`;
}
