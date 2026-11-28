/**
 * P6, R61: what the service worker keeps so the game opens offline (public/sw.js). Run at build time by vite.config.ts
 * (offlineWorker), over the chunks Rollup has just written.
 *
 * Every script the game page can load, the ones it imports at once and the ones it loads later (a sheet, a mini-game,
 * the room's renderer), each with its styles, and the faces its two languages are drawn in. The worker fetches the list
 * as it installs, so a game whose code arrived before the worker took control (a first visit) still has all of it.
 * The list once held only what the first screens import directly: about 30 scripts loaded behind the hatch screen were
 * never kept, and an offline reload after a first visit showed "Something went wrong" or a stuck splash (R61).
 */

/** What the list needs of one built chunk (Rollup's OutputChunk and Vite's metadata on it). */
export interface BuiltChunk {
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: readonly string[];
  dynamicImports: readonly string[];
  importedCss: Iterable<string>;
  importedAssets: Iterable<string>;
}

/**
 * The font subsets for scripts the game never writes in (its words are English and Chinese): a pet's name in one of
 * them is drawn in the device's own face offline, as the browser does for any character a face lacks.
 */
const OTHER_SCRIPTS = /-(cyrillic|cyrillic-ext|greek|greek-ext|devanagari|vietnamese)-wght-/;

/**
 * The home room's number (packages/world/src/places.ts HOME, which the build cannot import: the world's package loads
 * the brain's sources; offlineList.test.ts holds the two together).
 */
export const HOME_INDEX = 65;

/**
 * The home room's pictures, one for each time of day, from the world's sheet (packages/world/src/data/world.json). Home
 * is where every pet starts and comes back to, so it opens offline at any hour.
 */
export function homeRoomArt(rooms: ReadonlyArray<{ index: number; bgs: Record<string, string> }>): string[] {
  const home = rooms.find((r) => r.index === HOME_INDEX);
  if (!home)
    throw new Error(`the world's sheet has no home room (${HOME_INDEX}): the game would open offline without it`);
  return [...new Set(Object.values(home.bgs))];
}

/** The files the game keeps: the page and its extras first, then its code, styles and faces, each once. */
export function offlineFiles(chunks: readonly BuiltChunk[], page: string, extra: readonly string[]): string[] {
  const byName = new Map(chunks.map((c) => [c.fileName, c]));
  const entry = chunks.find(
    (c) => c.isEntry && !!c.facadeModuleId && c.facadeModuleId.split("\\").join("/").endsWith(`/${page}`),
  );
  if (!entry) throw new Error(`the bundle has no entry for ${page}: the game would keep nothing to open offline`);
  const code = new Set<string>();
  const walk = (name: string) => {
    const c = byName.get(name);
    if (!c || code.has(name)) return;
    code.add(name);
    for (const dep of [...c.imports, ...c.dynamicImports]) walk(dep);
  };
  walk(entry.fileName);
  const reached = chunks.filter((c) => code.has(c.fileName));
  const styles = reached.flatMap((c) => [...c.importedCss]);
  const assets = reached.flatMap((c) => [...c.importedAssets]);
  // the faces of the game's two languages, and anything else its code imports (a picture, a sound)
  const faces = assets.filter((f) => f.endsWith(".woff2") && !OTHER_SCRIPTS.test(f));
  const others = assets.filter((f) => !f.endsWith(".woff2"));
  return [...new Set([page, ...extra, ...code, ...styles, ...faces, ...others])];
}
