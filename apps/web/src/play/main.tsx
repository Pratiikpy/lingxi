import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { migrateLegacyNames } from "../boot/legacyNames";
import { claimTheGame } from "../game/saveRuntime";
import { startClock } from "../game/gameClock";
import { inTelegram, startTelegram } from "../game/telegram";
import { receivePets } from "../game/move";
import { LoadFailed } from "./LoadFailed";
import { type GameParts, isFirstVisit, loadGame } from "./gameParts";

startTelegram();
const root = createRoot(document.getElementById("root")!);

// P6: the game opens offline once it has been visited (public/sw.js). The on-chain copy is built with VITE_OFFLINE=off
// and registers no worker: its gateway's own verifier stays in charge of its pages
if (import.meta.env.PROD && import.meta.env.VITE_OFFLINE !== "off" && "serviceWorker" in navigator) {
  const register = () => void navigator.serviceWorker.register("sw.js").catch(() => undefined);
  if ("requestIdleCallback" in window) requestIdleCallback(register, { timeout: 5_000 });
  else setTimeout(register, 2_000);
}

/** The game itself: old names brought up to date, arriving pets landed and the clock set, then the game reads its save. */
async function play(): Promise<void> {
  migrateLegacyNames();
  // pets arriving from Telegram or another browser land before the game reads its save; the clock asks the server
  // for the time meanwhile, so a pet catches up to real time even on a device whose clock is wrong (gameClock.ts)
  await Promise.all([receivePets(), startClock()]);
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  // P3: a first visit gets a working hatch screen at once and the rest of the game behind it (FirstVisit.tsx)
  if (isFirstVisit(storage, location, inTelegram())) {
    const [{ FirstVisit }, { CrashGuard }] = await Promise.all([import("./FirstVisit"), import("./Crash")]);
    startTransition(() =>
      root.render(
        <StrictMode>
          <CrashGuard>
            <FirstVisit handOver={showGame} onFail={failedToLoad} />
          </CrashGuard>
        </StrictMode>,
      ),
    );
    return;
  }
  showGame(await loadGame());
}

let shown = false;
/** The full game on the page, once. */
function showGame({ PlayApp, CrashGuard }: GameParts): void {
  if (shown) return;
  shown = true;
  // P3: the game's first render is a transition, so React renders it in short slices and the page stays responsive
  // while it does; what shows meanwhile (the prerendered hatch screen, the first visit's own one, or the splash) stays
  // until it is ready
  startTransition(() =>
    root.render(
      <StrictMode>
        <CrashGuard>
          <PlayApp />
        </CrashGuard>
      </StrictMode>,
    ),
  );
}

/** A part of the game that could not be loaded (staleBuild.ts has already reloaded once if a new build went live). */
const failedToLoad = () =>
  root.render(
    <StrictMode>
      <LoadFailed />
    </StrictMode>,
  );

// nothing is read or written until this tab holds the game (P1): one tab plays, and a damaged save waits for the
// player's choice before anything can write over it
void claimTheGame()
  .then(async ({ playing, damaged }) => {
    if (!playing) {
      const { ElsewhereScreen } = await import("./SaveScreens");
      root.render(
        <StrictMode>
          <ElsewhereScreen />
        </StrictMode>,
      );
      return;
    }
    if (damaged.length) {
      const { RecoveryScreen } = await import("./SaveScreens");
      // once every part is settled the page starts afresh, so every store reads the save as it now is
      root.render(
        <StrictMode>
          <RecoveryScreen damaged={damaged} onDone={() => location.reload()} />
        </StrictMode>,
      );
      return;
    }
    await play();
  })
  .catch(failedToLoad);
