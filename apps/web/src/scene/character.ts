/**
 * The room's character (P7: out of RoomScene): its portrait stands to the right, behind the pets, at the world's own
 * pixel scale, breathing by a pixel; over its head, a pixel quest mark ("!" a quest to take, a tick one to hand in, a
 * star a friendship step). Tapping either opens the talk.
 */
import { type Container, Graphics, Sprite } from "pixi.js";
import { PET_FEET } from "./floor";
import { bodyHitArea } from "./hitArea";
import { bgTexture, drawMark } from "./roomArt";

export interface Character {
  update: (now: number, p: { npc: string | null; npcMark?: "!" | "✓" | "★" | null; reduceMotion: boolean }) => void;
}

export function createCharacter(world: Container, onTap: () => void): Character {
  const npc = new Sprite();
  npc.anchor.set(0.5, 1);
  npc.eventMode = "static";
  npc.cursor = "pointer";
  // every tappable sprite answers only on its drawn pixels, so a tap on one's margin reaches what is behind (A25)
  npc.hitArea = bodyHitArea(npc);
  npc.visible = false;
  npc.on("pointertap", () => onTap());
  world.addChild(npc);
  let shownNpc: string | null = null;
  // the quest mark over the character's head, drawn in pixels like everything else in the room
  const mark = new Graphics();
  mark.eventMode = "static";
  mark.cursor = "pointer";
  mark.on("pointertap", () => onTap());
  world.addChild(mark);
  let shownMark: string | null = null;
  const update: Character["update"] = (now, p) => {
    if (p.npc !== shownNpc) {
      shownNpc = p.npc;
      npc.visible = false;
      if (p.npc) {
        const want = p.npc;
        void bgTexture(`/art/npcs/${want}`).then((tex) => {
          if (shownNpc !== want || npc.destroyed) return;
          npc.texture = tex;
          npc.visible = true;
        });
      }
    }
    if (npc.visible) {
      npc.x = 104;
      // a one-pixel breath so the character never looks pasted on
      npc.y = PET_FEET + 6 + (!p.reduceMotion && Math.sin(now / 760) > 0.55 ? 1 : 0);
    }
    const wantMark = npc.visible ? (p.npcMark ?? null) : null;
    if (wantMark !== shownMark) {
      shownMark = wantMark;
      mark.clear();
      if (wantMark) drawMark(mark, wantMark);
    }
    if (wantMark) {
      // over the head when there is room, otherwise just inside the top of the room beside it (tall residents)
      const above = npc.y - npc.height - 12;
      mark.x = above >= 2 ? npc.x - 5 : Math.max(2, Math.round(npc.x - npc.width / 4) - 9);
      mark.y = Math.max(3, above) + (!p.reduceMotion ? Math.round(Math.sin(now / 320)) : 0);
    }
  };
  return { update };
}
