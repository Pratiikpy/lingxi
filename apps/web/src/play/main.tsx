import "../boot/staleBuild";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { migrateLegacyNames } from "../boot/legacyNames";
import { claimTheGame } from "../game/saveRuntime";
import { startClock } from "../game/gameClock";
import { startTelegram } from "../game/telegram";
import { receivePets } from "../game/move";
import { LoadFailed } from "./LoadFailed";

startTelegram();
const root = createRoot(document.getElementById("root")!);

/** The game itself: old names brought up to date, arriving pets landed and the clock set, then the game reads its save. */
async function play(): Promise<void> {
  migrateLegacyNames();
  // pets arriving from Telegram or another browser land before the game reads its save; the clock asks the server
  // for the time meanwhile, so a pet catches up to real time even on a device whose clock is wrong (gameClock.ts)
  await Promise.all([receivePets(), startClock()]);
  const [{ PlayApp }, { CrashGuard }] = await Promise.all([import("./PlayApp"), import("./Crash")]);
  root.render(
    <StrictMode>
      <CrashGuard>
        <PlayApp />
      </CrashGuard>
    </StrictMode>,
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
