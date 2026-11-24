/**
 * The game's public site, named once (P7: the address was written out in nine places in code). Copy that mentions the
 * site by name in a sentence keeps its own words; code that links to a page or sends a reader there uses this.
 */
export const LINGXI_SITE = "https://lingxi.knole.me";

/** A page on the public site, e.g. sitePage("verify.html#7"). */
export const sitePage = (path: string): string => `${LINGXI_SITE}/${path.replace(/^\//, "")}`;
