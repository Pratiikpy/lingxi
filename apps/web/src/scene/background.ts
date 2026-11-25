/**
 * The room's picture (P7: out of RoomScene): a still image or an animated GIF behind everything, swapped for the time
 * of day's when it changes. A missing picture keeps the last one rather than breaking the scene.
 */
import { Container, type Sprite } from "pixi.js";
import { makeBg } from "./roomArt";
import type { SceneProps } from "./RoomScene";

export interface Background {
  update: (p: Pick<SceneProps, "bgs" | "phase" | "reduceMotion">) => void;
}

export function createBackground(world: Container, first: Sprite, firstUrl: string): Background {
  const bgLayer = new Container();
  world.addChild(bgLayer);
  // purely visual layers never take taps; only the pet, the cat, the resident, visitors and placed pieces do
  bgLayer.eventMode = "none";
  let room: Sprite = first;
  bgLayer.addChild(room);
  const showBg = (next: Sprite) => {
    const old = room;
    room = next;
    bgLayer.addChild(next);
    old.removeFromParent();
    old.destroy();
  };
  let shownBg = firstUrl;
  const update: Background["update"] = (p) => {
    const wantBg = p.bgs[p.phase];
    if (wantBg !== shownBg) {
      shownBg = wantBg;
      void makeBg(wantBg, p.reduceMotion).then(
        (next) => {
          if (shownBg === wantBg && !bgLayer.destroyed) showBg(next);
          else next.destroy();
        },
        () => {
          // a missing background keeps the last one rather than breaking the scene
        },
      );
    }
  };
  return { update };
}
