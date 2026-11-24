/**
 * The season refought in a worker (A84): every entry against every other from both sides is seconds of work for a full
 * week of large minds, and on the page's main thread it froze the game for all of it. Given the week and its entries,
 * answers with the table's fingerprint.
 */
import { type SeasonEntry, seasonStandings, standingsDigest } from "@lingxi/game";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ week: string; entries: SeasonEntry[] }>) => void) | null;
  postMessage: (m: unknown) => void;
};

scope.onmessage = (e) => {
  scope.postMessage({ digest: standingsDigest(seasonStandings(e.data.week, e.data.entries)) });
};
