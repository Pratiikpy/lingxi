/**
 * Other players' pets in the room (P7: out of RoomScene): each stands on its lane within what shows, wanders a little,
 * wears its own look, shows its mood and emotes, and carries its name and its words in screen space so text stays
 * crisp. A resident keeps to the spot the room gives it. Pets that have left are taken away.
 */
import { type Container, Graphics, Sprite, Text } from "pixi.js";
import type { Expression } from "@lingxi/art";
import { NAME_COLOUR_BY_ID } from "@lingxi/world";
import { PET_FEET, WANDER, floorSpot, laneOf, type FloorView } from "./floor";
import { bodyHitArea } from "./hitArea";
import type { Particles } from "./particles";
import { halfOf } from "./residentSpot";
import type { SceneProps } from "./RoomScene";
import { type PetStage, glyphTexture, petTexture } from "./textures";

export interface Visitors {
  update: (
    now: number,
    p: Pick<SceneProps, "others" | "reduceMotion">,
    view: FloorView,
    spot: { id: string; x: number } | null,
    scale: number,
  ) => void;
}

export function createVisitors(ctx: {
  world: Container;
  ui: Container;
  el: HTMLElement;
  /** the player's own pet: visitors stand behind it */
  petSprite: Sprite;
  particles: Particles;
  onTap: (id: string) => void;
}): Visitors {
  const { world, ui, el, petSprite, particles, onTap } = ctx;
  interface Visitor {
    sprite: Sprite;
    tag: Text;
    bubble: Text;
    bubbleBg: Graphics;
    x: number;
    target: number;
    /** where in the whole room it means to stand: its lane, or a step from it as it wanders (A69) */
    lane: number;
    lastEmote: number;
  }
  const visitors = new Map<string, Visitor>();
  const update: Visitors["update"] = (now, p, view, spot, scale) => {
    const seen = new Set<string>();
    for (const o of p.others) {
      seen.add(o.id);
      let v = visitors.get(o.id);
      if (!v) {
        const sprite = new Sprite();
        sprite.anchor.set(0.5, 1);
        sprite.eventMode = "static";
        sprite.cursor = "pointer";
        sprite.hitArea = bodyHitArea(sprite);
        sprite.on("pointertap", () => onTap(o.id));
        world.addChildAt(sprite, world.getChildIndex(petSprite));
        const tag = new Text({
          text: o.name,
          style: {
            fontFamily: "Baloo 2 Variable, sans-serif",
            fontWeight: "800",
            fontSize: 12,
            fill: "#2B2140",
            stroke: { color: "#FFF7E8", width: 4 },
          },
        });
        tag.anchor.set(0.5, 1);
        const bubble = new Text({
          text: "",
          style: {
            fontFamily: "Baloo 2 Variable, sans-serif",
            fontWeight: "700",
            fontSize: 13,
            fill: "#2B2140",
            wordWrap: true,
            wordWrapWidth: 150,
            align: "center",
          },
        });
        bubble.anchor.set(0.5, 1);
        const bubbleBg = new Graphics();
        ui.addChild(tag, bubbleBg, bubble);
        const lane = o.look ? o.look.x : laneOf(o.id);
        const home = (spot?.id === o.id ? spot.x : undefined) ?? floorSpot(lane, view, halfOf(o.stage));
        v = { sprite, tag, bubble, bubbleBg, x: home, target: home, lane, lastEmote: 0 };
        visitors.set(o.id, v);
      }
      // a resident keeps to its spot, visitors wander near their lane; every pet stands within what shows, which moves
      // when the view is resized (A69)
      if (!o.look && !p.reduceMotion && Math.random() < 0.004)
        v.lane = Math.max(WANDER.min, Math.min(WANDER.max, laneOf(o.id) + (Math.random() * 24 - 12)));
      v.target =
        (spot?.id === o.id ? spot.x : undefined) ?? floorSpot(o.look ? o.look.x : v.lane, view, halfOf(o.stage));
      if (Math.abs(v.target - v.x) > 0.5) v.x += Math.sign(v.target - v.x) * 0.15;
      const stageName = o.stage === "elder" ? "adult" : o.stage;
      const expr = o.mood === 3 ? "sparkly" : o.mood === 2 ? "happy" : o.mood === 0 ? "sulk" : "neutral";
      v.sprite.texture = petTexture(
        (["gentle", "bold", "curious"].includes(o.line) ? o.line : "gentle") as SceneProps["line"],
        {
          stage: (["baby", "child", "teen", "adult"].includes(stageName) ? stageName : "baby") as PetStage,
          expression: (o.emote && now - o.emote.at < 2000
            ? o.emote.kind === "heart"
              ? "love"
              : "happy"
            : expr) as Expression,
          breath: p.reduceMotion ? 0 : Math.sin(now / 640 + v.x) > 0.35 ? 1 : 0,
          squash: 0,
          lit: !!o.look?.lit,
          ...(o.look ? { palette: o.look.palette, outfit: o.look.outfitAt(Date.now()) } : {}),
        },
      );
      v.sprite.scale.x = v.target < v.x ? -1 : 1;
      v.sprite.x = Math.round(v.x);
      v.sprite.y = PET_FEET + 2;
      if (o.emote && o.emote.at !== v.lastEmote) {
        v.lastEmote = o.emote.at;
        const kind =
          o.emote.kind === "heart" || o.emote.kind === "gift"
            ? "heart"
            : o.emote.kind === "laugh" || o.emote.kind === "dance"
              ? "note"
              : "spark";
        for (let i = 0; i < 4; i++) {
          const sp = new Sprite(glyphTexture(kind, i % 2 ? "#FFC83D" : "#FF7A9A"));
          sp.anchor.set(0.5);
          sp.x = v.x + (Math.random() * 12 - 6);
          sp.y = PET_FEET - 26;
          particles.add({ s: sp, vx: (Math.random() - 0.5) * 0.25, vy: -0.32, life: 1 });
        }
      }
      // the drawn pet is shorter than its 48-pixel canvas; place the tag just above its head
      const height = { baby: 15, child: 22, teen: 28, adult: 34 }[stageName as "baby"] ?? 20;
      const headPt = world.toGlobal({ x: v.x, y: PET_FEET + 2 - height - 2 });
      const top = headPt.y - scale * 10;
      const cx = headPt.x;
      // keep the name and the speech bubble inside the room, whatever side the pet stands on
      const viewW = el.clientWidth;
      // a coloured name (plan 4.9) on its cream outline uses the colour's light-theme value
      const fill = (o.colour && NAME_COLOUR_BY_ID[o.colour]?.light) || "#2B2140";
      if (v.tag.style.fill !== fill) v.tag.style.fill = fill;
      const tagW = v.tag.width;
      v.tag.position.set(Math.max(tagW / 2 + 4, Math.min(viewW - tagW / 2 - 4, cx)), top + scale * 10);
      const talking = o.say && now - o.say.at < 5000;
      v.bubble.text = talking ? o.say!.text : "";
      v.bubbleBg.clear();
      if (talking) {
        const b = v.bubble.getLocalBounds();
        const w = b.width + 16;
        const h = b.height + 10;
        const x0 = Math.max(6, Math.min(viewW - w - 6, cx - w / 2));
        const tail = Math.max(x0 + 12, Math.min(x0 + w - 12, cx));
        const y0 = top + scale * 10 - 24 - b.height - 5;
        v.bubble.position.set(x0 + w / 2, y0 + b.height + 5);
        v.bubbleBg.roundRect(x0, y0, w, h, 10).fill({ color: 0xfffdf8 }).stroke({ color: 0x2b2140, width: 2 });
        v.bubbleBg
          .moveTo(tail - 5, y0 + h)
          .lineTo(tail, y0 + h + 6)
          .lineTo(tail + 5, y0 + h)
          .fill({ color: 0xfffdf8 });
      }
    }
    for (const [id, v] of visitors) {
      if (seen.has(id)) continue;
      v.sprite.destroy();
      v.tag.destroy();
      v.bubble.destroy();
      v.bubbleBg.destroy();
      visitors.delete(id);
    }
  };
  return { update };
}
