/**
 * P3: the hatch screen, rendered to HTML at build time, so a first visit paints the game's first screen before any of its
 * script has arrived on a slow phone (vite.config.ts `prerenderPlay` renders it once per language, each in its own copy
 * of these modules, whose language store starts in that language). The game then renders the same screen over it.
 */
import { renderToString } from "react-dom/server";
import { Hatch } from "./Hatch";

export function render(): string {
  return renderToString(<Hatch onHatch={() => undefined} />);
}
