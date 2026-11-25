/**
 * The resident cat (P7: out of RoomScene). Its lane runs behind the pet, along the hut's doorstep: it walks, sits,
 * grooms and naps on its own clock (more naps at night or while the pet sleeps), and runs off when tapped. With reduced
 * motion it sits still.
 */
import { type Container, Sprite } from "pixi.js";
import type { DayPhase } from "./dayPhase";
import { ROOM } from "./floor";
import { bodyHitArea } from "./hitArea";
import { catTexture } from "./textures";

/** where the cat's feet stand */
const CAT_FEET = 96;

export interface Cat {
  sprite: Sprite;
  update: (now: number, p: { reduceMotion: boolean; phase: DayPhase; asleep: boolean }) => void;
}

export function createCat(world: Container): Cat {
  const cat = new Sprite(catTexture("sit0"));
  cat.anchor.set(0.5, 1);
  cat.eventMode = "static";
  cat.cursor = "pointer";
  cat.hitArea = bodyHitArea(cat);
  world.addChild(cat);
  const catState = {
    x: 24,
    dir: 1,
    mode: "walk" as "walk" | "sit" | "nap" | "run" | "groom",
    until: performance.now() + 5000,
  };
  cat.on("pointertap", (e) => {
    const local = world.toLocal(e.global);
    catState.mode = "run";
    catState.dir = local.x > catState.x ? -1 : 1;
    catState.until = performance.now() + 1400;
  });
  const update = (now: number, p: { reduceMotion: boolean; phase: DayPhase; asleep: boolean }) => {
    if (!p.reduceMotion) {
      if (catState.mode === "walk" || catState.mode === "run") {
        catState.x += catState.dir * (catState.mode === "run" ? 0.9 : 0.18);
        if (catState.x > ROOM - 12) {
          catState.x = ROOM - 12;
          catState.dir = -1;
        }
        if (catState.x < 12) {
          catState.x = 12;
          catState.dir = 1;
        }
      }
      if (now > catState.until) {
        const napChance = p.phase === "night" || p.asleep ? 0.55 : 0.18;
        const r = Math.random();
        if (catState.mode === "run") catState.mode = "walk";
        else if (catState.mode === "walk")
          catState.mode = r < napChance ? "nap" : r < napChance + 0.15 ? "groom" : "sit";
        else {
          catState.mode = "walk";
          if (Math.random() < 0.5) catState.dir *= -1;
        }
        catState.until =
          now + (catState.mode === "nap" ? 9000 : catState.mode === "walk" ? 6000 : 3500) + Math.random() * 4000;
      }
    } else catState.mode = "sit";
    const step = Math.floor(now / (catState.mode === "run" ? 90 : 170)) % 2;
    const tail = Math.floor(now / 380) % 3;
    cat.texture = catTexture(
      catState.mode === "walk" || catState.mode === "run"
        ? step
          ? "walk1"
          : "walk0"
        : catState.mode === "nap"
          ? "nap"
          : catState.mode === "groom"
            ? "groom"
            : (["sit0", "sit1", "sit2"] as const)[tail]!,
    );
    cat.scale.x = catState.dir;
    cat.x = Math.round(catState.x);
    cat.y = CAT_FEET;
  };
  return { sprite: cat, update };
}
