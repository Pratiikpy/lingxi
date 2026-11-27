/**
 * R43: the live numbers page rendered to HTML at build time, so a slow phone paints its header, its title, its
 * explanation and the note that it is reading the chain before any of the page's script has arrived (vite.config.ts
 * `prerenderPages` renders it once per language, each in its own copy of these modules, whose language store starts in
 * that language). It is the page before the server has answered, so it holds no number: the numbers appear only once
 * the page's code has read them from the server, and drawn over this.
 */
import { renderToString } from "react-dom/server";
import { NumbersApp } from "./NumbersApp";

export function render(): string {
  return renderToString(<NumbersApp />);
}
