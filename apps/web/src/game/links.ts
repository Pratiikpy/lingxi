/**
 * Links people share (gifts, red packets, proof pages). On DeWEB's default gateway
 * (`<id>-<area>-<processor>.tapekit.org`, where each visitor's browser verifies the
 * site itself) a first visit must start at `/`: the gateway installs its verifier
 * there, and a fresh visitor sent straight to `/play.html` only gets the gateway's
 * locked page. So on that host shared links start at `/` with `#go=page~fragment`,
 * and the landing page steps into the page at once.
 */

const SELF_VERIFYING_GATEWAY = /^\d+-\d+-\d+\.tapekit\.org$/;
const PAGES = ["play.html", "verify.html", "handheld.html", "numbers.html", "tree.html", "agents.html"] as const;
type Page = (typeof PAGES)[number];

/**
 * The longest fragment a `#go=` link carries: a duel result's whole code (two pets' cards, `MAX_DUEL_RESULT_CODE`)
 * after `duelr=`, since the on-chain copy has no server to keep it under a short id (A32).
 */
export const MAX_GO_FRAGMENT = 190_000;

const siteBase = () => `${location.origin}${location.pathname.replace(/[^/]*$/, "")}`;

/** Everything up to the fragment's content: append e.g. `gift=…` to it. */
export function linkPrefix(page: Page): string {
  return SELF_VERIFYING_GATEWAY.test(location.hostname) ? `${siteBase()}#go=${page}~` : `${siteBase()}${page}#`;
}

/** On the landing page: follow a `#go=` link to its page. Returns true when it is leaving. */
export function followGoLink(): boolean {
  const m = new RegExp(String.raw`^#go=([a-z]+\.html)(?:~([\w.=%~-]{0,${MAX_GO_FRAGMENT}}))?$`).exec(location.hash);
  if (!m || !(PAGES as readonly string[]).includes(m[1]!)) return false;
  location.replace(`${m[1]}${m[2] ? `#${m[2]}` : ""}`);
  return true;
}
