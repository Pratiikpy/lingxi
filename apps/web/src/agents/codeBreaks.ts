/**
 * R25: where a web address in a code sample may break when a narrow screen wraps it. An address breaks only where one
 * may: after a slash (never inside or right after the scheme's "//"), and before "?" or "&", so a query's "?" or one of
 * its parameters never sits alone on a line. Text that is not an address keeps the browser's own rules.
 */

export type CodePiece = { url: false; text: string } | { url: true; parts: string[] };

const ADDRESS = /https?:\/\/[^\s"'\\<>`]+/g;

/** An address cut at the places a line may break: each part is drawn whole, with a break opportunity between parts. */
function addressParts(url: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < url.length; i++) {
    const c = url[i];
    const breakBefore = (c === "?" || c === "&") && i > start;
    const breakAfter =
      c === "/" && url[i - 1] !== "/" && url[i + 1] !== "/" && i + 1 < url.length && url[i + 1] !== "?";
    if (breakBefore) {
      parts.push(url.slice(start, i));
      start = i;
    }
    if (breakAfter) {
      parts.push(url.slice(start, i + 1));
      start = i + 1;
    }
  }
  parts.push(url.slice(start));
  return parts;
}

/** One line of a code sample as plain text and addresses, every character kept, in order. */
export function codePieces(line: string): CodePiece[] {
  const pieces: CodePiece[] = [];
  let at = 0;
  for (const m of line.matchAll(ADDRESS)) {
    if (m.index > at) pieces.push({ url: false, text: line.slice(at, m.index) });
    pieces.push({ url: true, parts: addressParts(m[0]) });
    at = m.index + m[0].length;
  }
  if (at < line.length || pieces.length === 0) pieces.push({ url: false, text: line.slice(at) });
  return pieces;
}
