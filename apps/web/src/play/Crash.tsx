/**
 * If a screen of the game fails while drawing, the player sees this instead of a blank page: what happened, that their
 * pets and save are safe (a drawing failure changes nothing saved), and a way back. React catches a render failure
 * only in a class component, so this one is a class.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLang } from "../i18n";
import "./save-screens.css";

function CrashScreen() {
  const zh = useLang((s) => s.lang) === "zh";
  return (
    <main className="save-screen" aria-labelledby="crash-title">
      <section className="save-card" role="alert">
        <h1 id="crash-title">{zh ? "这个画面出了点问题" : "Something went wrong on this screen"}</h1>
        <p>{zh ? "你的宠物和存档都安全，画面出错不会改动存档。重新加载就能回到游戏。" : "Your pets and your save are safe: a screen failing to draw changes nothing saved. Reload to go back to the game."}</p>
        <button type="button" className="save-btn primary" onClick={() => location.reload()} autoFocus>
          {zh ? "重新加载" : "Reload"}
        </button>
      </section>
    </main>
  );
}

export class CrashGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // kept in the console for whoever looks into it; the player sees the screen above
    console.error("Lingxi: a screen failed to draw", error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
