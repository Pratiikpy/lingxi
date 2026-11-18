/**
 * A4: a page left open across a deploy loads some parts on demand, from the build it came from. The server keeps an
 * earlier build's files for two weeks; if a part still fails to load, the page reloads once into the build that is live
 * now. The build a reload was made for is remembered for the visit, so a part that fails again is not reloaded for
 * twice: the game's crash guard says so instead of looping.
 */

const RELOADED_FOR = "lingxi.reloadedFor";

/** This page's own build, named by the file its entry script came from (each build's names differ). */
const thisBuild = (): string => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? location.pathname;

window.addEventListener("vite:preloadError", (event) => {
  const build = thisBuild();
  try {
    if (sessionStorage.getItem(RELOADED_FOR) === build) return;
    sessionStorage.setItem(RELOADED_FOR, build);
  } catch {
    // without session storage a reload could not be remembered, so none is made
    return;
  }
  event.preventDefault();
  location.reload();
});
