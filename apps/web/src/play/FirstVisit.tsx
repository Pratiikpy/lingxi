/**
 * A first visit's game page (P3): the hatch screen on its own, working from the moment it is drawn, while the rest of the
 * game (about 400 KB of code) loads behind it. A slow phone used to show the hatch screen drawn but frozen until all of
 * the game had arrived and run.
 *
 * The game starts loading at the player's first touch or key, when they open the save-file sheet, or after a few quiet
 * seconds, whichever comes first; once it is in, the page hands over to the full game at a calm moment (no finger down,
 * no name being typed, no egg cracking), and the full game mounts the same hatch screen with every choice kept
 * (hatchDraft.ts). Hatching before the game is in waits for it on the last crack frame, then lands in the room.
 */
import { useEffect } from "react";
import { Hatch } from "./Hatch";
import { useHatchDraft } from "./hatchDraft";
import { keepFocus } from "./handoverFocus";
import { useSaveFileUi } from "./saveFileUi";
import { type GameParts, loadGame } from "./gameParts";
import { WARM_AFTER_MS } from "../game/warm";
import { play } from "../game/sound";

/** How often a loaded game checks for a calm moment to take over. */
const CALM_CHECK_MS = 400;

export function FirstVisit({ handOver, onFail }: { handOver: (game: GameParts) => void; onFail: () => void }) {
  useEffect(() => {
    let over = false;
    let fingerDown = false;
    // R58: a key held down is no calm moment: the swap would take the control from under it
    let keyDown = false;
    let calmTimer: ReturnType<typeof setInterval> | null = null;
    const finish = (game: GameParts) => {
      if (over) return;
      over = true;
      stop();
      // R58: where the keyboard is, kept for the full game's hatch screen to put back
      keepFocus(document.querySelector(".hatch"));
      handOver(game);
    };
    const calm = () =>
      !fingerDown &&
      !keyDown &&
      useHatchDraft.getState().cracking < 0 &&
      !(document.activeElement instanceof HTMLInputElement);
    const load = () => {
      void loadGame().then(
        (game) => {
          if (over || calmTimer) return;
          if (calm()) return finish(game);
          calmTimer = setInterval(() => calm() && finish(game), CALM_CHECK_MS);
        },
        () => !over && onFail(),
      );
    };
    const down = () => {
      fingerDown = true;
      load();
    };
    const up = () => {
      fingerDown = false;
    };
    const keyPressed = () => {
      keyDown = true;
      load();
    };
    // a key let go, or the window left with one down (its keyup then never comes here)
    const keyLifted = () => {
      keyDown = false;
    };
    const idle = setTimeout(load, WARM_AFTER_MS);
    const unsubSheet = useSaveFileUi.subscribe((s) => s.open && load());
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("keydown", keyPressed, true);
    window.addEventListener("keyup", keyLifted, true);
    window.addEventListener("blur", keyLifted);
    function stop() {
      clearTimeout(idle);
      if (calmTimer) clearInterval(calmTimer);
      unsubSheet();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("keydown", keyPressed, true);
      window.removeEventListener("keyup", keyLifted, true);
      window.removeEventListener("blur", keyLifted);
    }
    return () => {
      over = true;
      stop();
    };
  }, [handOver, onFail]);

  return (
    <Hatch
      onHatch={(line, name, instincts) => {
        // the full game's own hatching (PlayApp.tsx), once its code is in; the screen holds the last crack frame meanwhile
        void loadGame().then(
          (game) => {
            game.useGame.getState().hatch(line, name, instincts);
            useHatchDraft.getState().reset();
            play("success");
            handOver(game);
          },
          () => onFail(),
        );
      }}
    />
  );
}
