/**
 * Shown when the game's own parts cannot be loaded at all (no connection on a first visit, or a part missing even after
 * the page reloaded for a new build). It ships with the page itself, so it can always be drawn; nothing is lost, since
 * the game has not read or written anything yet.
 */

import { useLang } from "../i18n";
import "./save-screens.css";

export function LoadFailed() {
  const zh = useLang((s) => s.lang) === "zh";
  return (
    <main className="save-screen" aria-labelledby="load-failed-title">
      <section className="save-card" role="alert">
        <h1 id="load-failed-title">{zh ? "灵犀没能加载" : "Lingxi couldn't load"}</h1>
        <p>
          {zh
            ? "游戏的一部分没有下载下来，可能是网络断了。你的宠物和存档都好好的。连上网络后重新加载。"
            : "Part of the game didn't download, most likely the connection dropped. Your pets and your save are fine. Reload once you're connected."}
        </p>
        <button type="button" className="save-btn primary" onClick={() => location.reload()} autoFocus>
          {zh ? "重新加载" : "Reload"}
        </button>
      </section>
    </main>
  );
}
