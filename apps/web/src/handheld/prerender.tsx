/**
 * R39: the handheld page rendered to HTML at build time, so a slow phone paints its header, the device with its keys and
 * what the device is doing before any of the page's script has arrived (vite.config.ts `prerenderPages` renders it once
 * per language, each in its own copy of these modules, whose language store starts in that language, and once for each
 * answer to whether a pet is coming aboard). The page then renders the same screen over it and starts the firmware.
 */
import { renderToString } from "react-dom/server";
import { HandheldApp } from "./HandheldApp";
import { ABOARD_KEYS, PrerenderAboard } from "./aboard";

/** What the page's first script reads to pick between the two renders. */
export const variantKeys = ABOARD_KEYS;

export function render(aboard: boolean): string {
  return renderToString(
    <PrerenderAboard.Provider value={aboard}>
      <HandheldApp />
    </PrerenderAboard.Provider>,
  );
}
