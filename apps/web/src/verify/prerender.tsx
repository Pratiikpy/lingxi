/**
 * R39: the proof page rendered to HTML at build time, so a slow phone paints its header, its explanation, the pet's
 * waiting card and its tables of contracts, rules and circuits before any of the page's script has arrived
 * (vite.config.ts `prerenderPages` renders it once per language, each in its own copy of these modules, whose language
 * store starts in that language). The page then renders the same screen over it and reads X Layer.
 */
import { renderToString } from "react-dom/server";
import { VerifyApp } from "./VerifyApp";

export function render(): string {
  return renderToString(<VerifyApp />);
}
