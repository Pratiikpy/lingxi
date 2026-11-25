/**
 * The home's decorations (P7: out of RoomScene): each placed piece drawn at twice the room's pixel size, pieces that
 * stand behind the pet's feet behind it and the rest in front, flat ones first so a rug never covers a lamp. While
 * decorating, tapping a piece picks it up. Redrawn only when the placed list changes.
 */
import { type Container, Sprite } from "pixi.js";
import { DECOR_BY_ID } from "@lingxi/world";
import { PET_FEET } from "./floor";
import type { SceneProps } from "./RoomScene";
import { pixelTexture } from "./textures";

type Placed = SceneProps["decor"];

export interface Decor {
  update: (list: Placed) => void;
}

export function createDecor(
  decorBack: Container,
  decorFront: Container,
  opts: { decorating: () => boolean; onTap: (id: string) => void },
): Decor {
  let shownDecor = "";
  const showDecor = (list: Placed) => {
    for (const c of [...decorBack.removeChildren(), ...decorFront.removeChildren()]) c.destroy();
    // flat pieces first, then by depth, so a rug never covers a lamp standing on it
    for (const d of [...list].sort(
      (a, b) => Number(!!DECOR_BY_ID[b.id]?.flat) - Number(!!DECOR_BY_ID[a.id]?.flat) || a.y - b.y,
    )) {
      const def = DECOR_BY_ID[d.id];
      if (!def) continue;
      const sp = new Sprite(pixelTexture(`decor:${d.id}`, def.rows, def.colors));
      sp.anchor.set(0.5, 1);
      // drawn at twice the room's pixel size so a piece sits at a believable scale beside the pet
      sp.scale.set(2);
      sp.x = d.x;
      sp.y = d.y;
      sp.eventMode = "static";
      sp.on("pointertap", (e) => {
        if (!opts.decorating()) return;
        e.stopPropagation();
        opts.onTap(d.id);
      });
      (def.flat || d.y < PET_FEET ? decorBack : decorFront).addChild(sp);
    }
  };
  const update = (list: Placed) => {
    const decorKey = JSON.stringify(list);
    if (decorKey !== shownDecor) {
      shownDecor = decorKey;
      showDecor(list);
    }
  };
  return { update };
}
