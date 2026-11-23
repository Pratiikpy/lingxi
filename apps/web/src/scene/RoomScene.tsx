/**
 * The pet's room, drawn with PixiJS. The 128×128 room art is scaled by
 * a whole number to fill the box (crisp, never blurred); the pet stands on the
 * floor and lives on its own; a resident cat wanders the front edge.
 *
 * React owns the props; the Pixi ticker reads the latest values through a ref,
 * so the scene never rebuilds on a state change.
 */

import { habitPose } from "./habitPose";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
// the site sends a script policy without eval; this module gives Pixi the code paths that never need it
import "pixi.js/unsafe-eval";
import { AnimatedGIF } from "@pixi/gif";
import type { Expression } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";
import { DECOR_BY_ID, NAME_COLOUR_BY_ID } from "@lingxi/world";
import { BITS, type PetStage, catTexture, glowTexture, glyphTexture, petTexture, pixelTexture, vignetteTexture } from "./textures";
import { HALF, PET_HOME, ROOM, WANDER, floorSpot, laneOf, sceneScale, type FloorView } from "./floor";
import { bodyHitArea } from "./hitArea";

export type DayPhase = "day" | "evening" | "night";

export { type Weather, weatherFor } from "./weather";
import { weatherFor } from "./weather";

/** How tall each stage stands, to put things above its head. */
const HEAD = { baby: 15, child: 22, teen: 28, adult: 34 } as const;

export interface SceneProps {
  line: StarterLine;
  stage: PetStage;
  /** the adult form care and diet chose */
  form?: import("@lingxi/art").Form;
  asleep: boolean;
  /** away on a trip: the room stands empty of it */
  absent?: boolean;
  /** what it wears (cosmetic) */
  outfit?: import("@lingxi/art").Outfit;
  /** ill from neglect: dizzy face and little green swirls */
  sick: boolean;
  want: number;
  mood: number;
  /** G1: the event of the beat just shown (0 none, 1 a friend, 2 a toy, 3 a noise) and performance.now() it began */
  event?: number;
  eventAt?: number;
  /** G1: the rule deciding now is one the player taught: a light bulb over the pet */
  taught?: boolean;
  /** D6: the pet's strongest habit, shown now and then while it rests */
  habit?: string | null;
  phase: DayPhase;
  /** performance.now() of the last care and what it was (and the food's picture, when fed) */
  lastCare: { kind: string; at: number; food?: string } | null;
  /** cleanliness 0..1000: dust bunnies gather when it runs low */
  clean: number;
  /** fullness 0..1000: a thought of food appears when it runs low, whatever the brain decides */
  food: number;
  /** under the sky (weather shows) or under a roof */
  outdoors: boolean;
  /** a sheet covers the room: moments wait until it can be seen */
  covered: boolean;
  /** decorations standing in this room (the home), or none */
  decor: Array<{ id: string; x: number; y: number }>;
  /** decorating: a tap on the room places the chosen piece, a tap on a piece picks it up */
  decorating: boolean;
  onPlace: (x: number, y: number) => void;
  onDecorTap: (id: string) => void;
  onPetTap: () => void;
  reduceMotion: boolean;
  /** the current room's backgrounds */
  bgs: { day: string; evening: string; night: string };
  /** other players' pets here right now */
  others: Array<{
    id: string;
    name: string;
    line: string;
    stage: string;
    mood: number;
    /** the pet's name colour (plan 4.9), when the server checked a linked wallet owns it */
    colour?: number;
    emote?: { kind: string; at: number };
    say?: { text: string; at: number };
    /** a resident: its own colours and props, a fixed place to stand, and whether its trace glows */
    look?: { palette: { key: string; colors: import("@lingxi/art").Palette }; outfitAt: (ms: number) => import("@lingxi/art").Outfit; x: number; lit?: boolean };
  }>;
  onOtherTap: (id: string) => void;
  /** the character standing in this room (portrait file), if any */
  npc: string | null;
  /** over the character's head: "!" when they have a quest for you, "✓" when one is ready to hand in */
  npcMark?: "!" | "✓" | "★" | null;
  onNpcTap: () => void;
}

/** The quest mark: a little pixel sign, "!" in gold for a quest to take, a tick in green for one to hand in. */
const MARKS: Record<"!" | "✓" | "★", { rows: string[]; fill: string }> = {
  "!": { rows: [".OOOOOOO.", "OyyyKyyyO", "OyyyKyyyO", "OyyyKyyyO", "OyyyyyyyO", "OyyyKyyyO", "OyyyyyyyO", ".OOOOOOO.", "...OyO...", "....O...."], fill: "#FFC83D" },
  "✓": { rows: [".OOOOOOO.", "OyyyyyyyO", "OyyyyyyKO", "OyKyyyKyO", "OyyKyKyyO", "OyyyKyyyO", "OyyyyyyyO", ".OOOOOOO.", "...OyO...", "....O...."], fill: "#7FD48A" },
  // a friendship step is waiting (plan 4.3)
  "★": { rows: [".OOOOOOO.", "OyyyKyyyO", "OyyKKKyyO", "OKKKKKKKO", "OyKKKKKyO", "OyKKyKKyO", "OyyyyyyyO", ".OOOOOOO.", "...OyO...", "....O...."], fill: "#F49AC1" },
};
function drawMark(g: Graphics, kind: "!" | "✓" | "★"): void {
  const m = MARKS[kind];
  m.rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      g.rect(x, y, 1, 1).fill(ch === "y" ? m.fill : "#2B2140");
    }),
  );
}

const bgCache = new Map<string, Texture>();
async function bgTexture(url: string): Promise<Texture> {
  const hit = bgCache.get(url);
  if (hit) return hit;
  const t: Texture = await Assets.load(url);
  t.source.scaleMode = "nearest";
  bgCache.set(url, t);
  return t;
}
const gifCache = new Map<string, Promise<ArrayBuffer>>();
/** A room background: a still image, or an animated GIF (three rooms move). */
async function makeBg(url: string, still: boolean): Promise<Sprite> {
  if (!url.endsWith(".gif")) return new Sprite(await bgTexture(url));
  let buf = gifCache.get(url);
  if (!buf) {
    buf = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`background ${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    gifCache.set(url, buf);
  }
  const gif = AnimatedGIF.fromBuffer(await buf, { scaleMode: "nearest", autoPlay: !still });
  return gif;
}
/** where the pet stands when nothing else shares its floor */
/** half the drawn width of each stage, to keep two pets apart */
const PET_FEET = 104;
/** CSS pixels at the room's foot the thinking strip lies over; the pet's feet stay above them. */
const STRIP_ROOM = 76;
const CAT_FEET = 96;

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  /** pull downward each frame (crumbs fall; hearts and notes float) */
  g?: number;
}

/** Something drifting through the room: fireflies, pollen, rain, snow, petals. */
interface Drift {
  s: Sprite;
  kind: "firefly" | "mote" | "drop" | "flake" | "petal";
  vx: number;
  vy: number;
  ph: number;
}

function expressionFor(p: SceneProps, now: number, blinking: boolean): { e: Expression; lit: boolean } {
  const care = p.lastCare && now - p.lastCare.at < 2600 ? p.lastCare.kind : null;
  if (p.asleep) return { e: "asleep", lit: false };
  if (p.sick && !care) return { e: "dizzy", lit: false };
  if (care === "feed") return { e: Math.floor(now / 220) % 2 ? "munch" : "munchShut", lit: true };
  if (care === "pet") return { e: "love", lit: true };
  if (care === "clean") return { e: now - p.lastCare!.at < 900 ? "sneeze" : "happy", lit: true };
  if (care === "play") return { e: "happy", lit: true };
  if (blinking) return { e: "asleep", lit: false };
  if (p.want === 5) return { e: "sulk", lit: false };
  if (p.want === 3) return { e: "sleepy", lit: false };
  if (p.want === 1) return { e: "sad", lit: false };
  if (p.want === 6) return { e: "shy", lit: true };
  if (p.mood === 3) return { e: "sparkly", lit: true };
  if (p.mood === 2) return { e: "happy", lit: false };
  if (p.mood === 0) return { e: "sulk", lit: false };
  return { e: "neutral", lit: false };
}

/** How deep the room goes while the pet sleeps (0 bright, 1 black): dim enough to read as lights out, the pet still seen. */
const LIGHTS_OUT = 0.42;

export function RoomScene(props: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  // the scene draws from the latest props on its own clock; they are handed over as each render commits
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let ready = false;
    const app = new Application();
    let cleanup = () => {};
    // the app is destroyed exactly once, whichever side gets there first (Pixi's resize plugin throws on a second)
    let destroyed = false;
    const destroyApp = () => {
      if (destroyed) return;
      destroyed = true;
      app.destroy(true, { children: true });
    };

    (async () => {
      await app.init({ backgroundAlpha: 0, antialias: false, resizeTo: el, autoDensity: true, resolution: window.devicePixelRatio || 1 });
      ready = true;
      if (disposed) {
        destroyApp();
        return;
      }
      el.appendChild(app.canvas);
      app.canvas.classList.add("pixel");
      app.canvas.style.display = "block";

      const first = await makeBg(latest.current.bgs[latest.current.phase], latest.current.reduceMotion);
      if (disposed) {
        first.destroy();
        destroyApp();
        return;
      }

      const world = new Container();
      app.stage.addChild(world);
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
      const shadeLayer = new Container();
      world.addChild(shadeLayer);
      shadeLayer.eventMode = "none";
      // the room's character stands to the right, behind the pets, at the world's own pixel scale
      const npc = new Sprite();
      npc.anchor.set(0.5, 1);
      npc.eventMode = "static";
      npc.cursor = "pointer";
      // every tappable sprite answers only on its drawn pixels, so a tap on one's margin reaches what is behind (A25)
      npc.hitArea = bodyHitArea(npc);
      npc.visible = false;
      npc.on("pointertap", () => latest.current.onNpcTap());
      world.addChild(npc);
      let shownNpc: string | null = null;
      // the quest mark over the character's head, drawn in pixels like everything else in the room
      const mark = new Graphics();
      mark.eventMode = "static";
      mark.cursor = "pointer";
      mark.on("pointertap", () => latest.current.onNpcTap());
      world.addChild(mark);
      let shownMark: string | null = null;
      // the cat's lane runs behind the pet, along the hut's doorstep
      const cat = new Sprite(catTexture("sit0"));
      cat.anchor.set(0.5, 1);
      cat.eventMode = "static";
      cat.cursor = "pointer";
      cat.hitArea = bodyHitArea(cat);
      world.addChild(cat);
      const pet = new Sprite();
      pet.anchor.set(0.5, 1);
      pet.eventMode = "static";
      pet.cursor = "pointer";
      pet.hitArea = bodyHitArea(pet);
      world.addChild(pet);
      // living details: dust bunnies on the floor behind the cat and pet; the food, the ball and
      // the "hungry" thought in front of the pet; drifting motes and weather over everything
      const floor = new Container();
      world.addChildAt(floor, world.getChildIndex(cat));
      floor.eventMode = "none";
      const bunnies = [new Sprite(BITS.bunny(false)), new Sprite(BITS.bunny(false))];
      bunnies.forEach((b, i) => {
        b.anchor.set(0.5, 1);
        b.x = i ? 42 : 88;
        b.visible = false;
        floor.addChild(b);
      });
      // decorations: pieces standing behind the pet's feet go behind it, the rest in front
      const decorBack = new Container();
      world.addChildAt(decorBack, world.getChildIndex(cat));
      const decorFront = new Container();
      world.addChild(decorFront);
      let shownDecor = "";
      const showDecor = (list: SceneProps["decor"]) => {
        for (const c of [...decorBack.removeChildren(), ...decorFront.removeChildren()]) c.destroy();
        // flat pieces first, then by depth, so a rug never covers a lamp standing on it
        for (const d of [...list].sort((a, b) => Number(!!DECOR_BY_ID[b.id]?.flat) - Number(!!DECOR_BY_ID[a.id]?.flat) || a.y - b.y)) {
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
            if (!latest.current.decorating) return;
            e.stopPropagation();
            latest.current.onDecorTap(d.id);
          });
          (def.flat || d.y < PET_FEET ? decorBack : decorFront).addChild(sp);
        }
      };
      const props = new Container();
      world.addChild(props);
      props.eventMode = "none";
      const ball = new Sprite(BITS.ball());
      ball.anchor.set(0.5);
      ball.visible = false;
      const food = new Sprite();
      food.anchor.set(0.5);
      food.visible = false;
      let foodScale = 0.4;
      const thought = new Sprite(BITS.bubble());
      thought.anchor.set(0.5, 1);
      thought.visible = false;
      const thoughtFood = new Sprite();
      thoughtFood.anchor.set(0.5);
      thoughtFood.visible = false;
      // G1: what the living room brings (a toy, a friend, a noise) and the light bulb of a taught lesson
      const visitorToy = new Sprite(BITS.ball());
      visitorToy.anchor.set(0.5, 1);
      visitorToy.visible = false;
      const visitorFriend = new Sprite(BITS.friend(false));
      visitorFriend.anchor.set(0.5, 1);
      visitorFriend.visible = false;
      const alarm = new Sprite(BITS.alarm());
      alarm.anchor.set(0.5, 1);
      alarm.visible = false;
      const bulb = new Sprite(BITS.bulb());
      bulb.anchor.set(0.5, 1);
      bulb.visible = false;
      props.addChild(ball, food, thought, thoughtFood, visitorToy, visitorFriend, alarm, bulb);
      void bgTexture("/art/items/rice_mochi.png").then((t) => {
        if (thoughtFood.destroyed) return;
        thoughtFood.texture = t;
        thoughtFood.scale.set(10 / Math.max(t.width, t.height));
      });
      // B7: lights out while the pet sleeps: a deep veil over the room and the pet, under the Zzz and the fireflies
      const lightsOut = new Sprite(Texture.WHITE);
      lightsOut.eventMode = "none";
      lightsOut.tint = 0x120d26;
      lightsOut.width = ROOM;
      lightsOut.height = ROOM;
      lightsOut.alpha = 0;
      world.addChild(lightsOut);
      const fx = new Container();
      world.addChild(fx);
      const sky = new Container();
      world.addChild(sky);
      fx.eventMode = "none";
      sky.eventMode = "none";
      // light: a warm pool around the pet at dusk and night, soft corners always
      const glow = new Sprite(glowTexture());
      // light only: it must never catch a tap meant for the pet, the cat or a visitor
      glow.eventMode = "none";
      glow.anchor.set(0.5);
      glow.blendMode = "add";
      glow.alpha = 0;
      world.addChildAt(glow, world.getChildIndex(floor));
      const vignette = new Sprite(vignetteTexture());
      vignette.eventMode = "none";
      vignette.width = ROOM;
      vignette.height = ROOM;
      world.addChild(vignette);
      const drifts: Drift[] = [];
      const weather = weatherFor(new Date());
      // where the pet stands this frame: the room's middle, or beside a resident when the visible floor is narrow
      let PET_X = PET_HOME;
      const residentSpot = new Map<string, number>();
      // the pet turns toward where you point
      let lookX = PET_X;
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointermove", (e) => {
        lookX = world.toLocal(e.global).x;
      });
      app.stage.on("pointertap", (e) => {
        if (!latest.current.decorating) return;
        const at = world.toLocal(e.global);
        latest.current.onPlace(at.x, at.y);
      });
      let feedAt = -1;
      let playAt = -1;
      // a feed or play that happened while a sheet covered the room plays when it is seen
      let feedWaiting = -1;
      let playWaiting = -1;
      let lastZ = 0;
      // visitors' name tags and speech live in screen space so text stays crisp
      const ui = new Container();
      app.stage.addChild(ui);
      ui.eventMode = "none";
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
      /** the part of the room that shows (a phone crops the sides), in room pixels */
      const view: FloorView = { left: 0, right: ROOM };
      /** half the width of a pet at a stage that may be one the room does not draw (an elder stands as an adult) */
      const halfOf = (stage: string) => HALF[(stage in HALF ? stage : "adult") as keyof typeof HALF];

      let scale = 1;
      const layout = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        // the largest whole-number scale that covers the box, cropped evenly
        scale = sceneScale(w, h);
        world.scale.set(scale);
        world.x = Math.round((w - ROOM * scale) / 2);
        // cropped evenly, but never so the pet's feet sink under the thinking strip along the room's foot (a shorter
        // room on a phone, with more lines in the care panel below it, otherwise lost the pet's lower half)
        world.y = Math.round(Math.min((h - ROOM * scale) / 2, h - STRIP_ROOM - PET_FEET * scale));
      };
      layout();
      const ro = new ResizeObserver(layout);
      ro.observe(el);

      const particles: Particle[] = [];
      const burst = (kind: "heart" | "spark" | "note", n: number, colors: string[]) => {
        for (let i = 0; i < n; i++) {
          const s = new Sprite(glyphTexture(kind, colors[i % colors.length]!));
          s.anchor.set(0.5);
          s.x = PET_X + (Math.random() * 18 - 9);
          s.y = PET_FEET - 30 - Math.random() * 6;
          fx.addChild(s);
          particles.push({ s, vx: (Math.random() - 0.5) * 0.25, vy: -0.32 - Math.random() * 0.2, life: 1 });
        }
      };

      let hopAt = -1;
      pet.on("pointertap", (e) => {
        if (latest.current.decorating) return;
        e.stopPropagation();
        latest.current.onPetTap();
        if (!latest.current.asleep && !latest.current.reduceMotion) hopAt = performance.now();
        if (!latest.current.asleep) burst("heart", 5, ["#FF7A9A", "#FFC83D"]);
      });

      const catState = { x: 24, dir: 1, mode: "walk" as "walk" | "sit" | "nap" | "run" | "groom", until: performance.now() + 5000 };
      cat.on("pointertap", (e) => {
        const local = world.toLocal(e.global);
        catState.mode = "run";
        catState.dir = local.x > catState.x ? -1 : 1;
        catState.until = performance.now() + 1400;
      });

      let lastCareAt = -1;
      let blinkAt = performance.now() + 1500;
      let shownBg = latest.current.bgs[latest.current.phase];

      const tick = () => {
        const now = performance.now();
        const p = latest.current;
        {
          view.left = Math.max(0, -world.x / scale);
          view.right = Math.min(ROOM, view.left + el.clientWidth / scale);
          const { left, right } = view;
          const resident = p.others.find((o) => o.look);
          residentSpot.clear();
          PET_X = PET_HOME;
          if (resident?.look) {
            const hp = HALF[p.stage];
            const hr = halfOf(resident.stage);
            const onRight = resident.look.x >= PET_HOME;
            const want = Math.max(left + hr + 2, Math.min(right - hr - 2, resident.look.x));
            const gap = Math.abs(want - PET_HOME) - hp - hr;
            if (gap >= 4) residentSpot.set(resident.id, want);
            else {
              // not enough floor: stand the two side by side, centred in what shows
              const total = 2 * hp + 2 * hr + 6;
              const start = left + Math.max(2, (right - left - total) / 2);
              PET_X = Math.round(onRight ? start + hp : start + 2 * hr + 6 + hp);
              residentSpot.set(resident.id, Math.round(onRight ? start + 2 * hp + 6 + hr : start + hr));
            }
          }
        }
        const decorKey = JSON.stringify(p.decor);
        if (decorKey !== shownDecor) {
          shownDecor = decorKey;
          showDecor(p.decor);
        }
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
        // a poorly pet gives off a little green swirl now and then
        if (p.sick && !p.asleep && !p.reduceMotion && Math.random() < 0.012) burst("spark", 1, ["#7BD389", "#5FB46F"]);
        if (p.lastCare && p.lastCare.at !== lastCareAt) {
          lastCareAt = p.lastCare.at;
          if (p.lastCare.kind === "feed") {
            burst("heart", 3, ["#FF7A9A"]);
            // the food arcs in from the side, then gets eaten bite by bite
            const art = p.lastCare.food;
            if (art && !p.reduceMotion) {
              feedWaiting = now;
              food.visible = false;
              void bgTexture(art.startsWith("/") ? art : `/${art}`).then((t) => {
                if (food.destroyed) return;
                food.texture = t;
                foodScale = { baby: 8, child: 10, teen: 12, adult: 13 }[latest.current.stage] / Math.max(t.width, t.height);
                food.scale.set(foodScale);
              });
            }
          }
          if (p.lastCare.kind === "clean") burst("spark", 8, ["#FFFFFF", "#FFC83D"]);
          if (p.lastCare.kind === "play") {
            burst("note", 3, ["#2F7FD6"]);
            if (!p.reduceMotion) playWaiting = now;
          }
        }
        if (now > blinkAt) blinkAt = now + 2400 + Math.random() * 2400;
        const blinking = now > blinkAt - 140;
        let { e, lit } = expressionFor(p, now, blinking);
        let squash: -1 | 0 | 1 = 0;
        let lift = 0;
        // D6: a small habit while its circuit chooses to rest (habitPose: timed by the clock, never at random)
        const resting = !p.asleep && !p.sick && p.want === 0 && !(p.lastCare && now - p.lastCare.at < 2600) && !p.reduceMotion;
        const pose = habitPose(p.habit, now, resting);
        const habitShift = pose?.shift ?? 0;
        if (pose) {
          if (pose.expression) e = pose.expression;
          if (pose.squash) squash = 1;
          if (pose.face) pet.scale.x = pose.face;
          if (pose.hop && hopAt < 0) hopAt = now;
        }
        if (hopAt >= 0) {
          const k = (now - hopAt) / 520;
          if (k > 1) hopAt = -1;
          else if (k < 0.16 || k > 0.84) squash = -1;
          else {
            squash = 1;
            lift = Math.round(Math.sin(((k - 0.16) / 0.68) * Math.PI) * 7);
          }
        }
        const breath: 0 | 1 = p.reduceMotion ? 0 : Math.sin(now / (p.asleep ? 900 : 620)) > 0.35 ? 1 : 0;
        pet.texture = petTexture(p.line, { stage: p.stage, expression: e, breath, squash, lit, ...(p.form ? { form: p.form } : {}), ...(p.outfit ? { outfit: p.outfit } : {}) });
        pet.x = PET_X + habitShift;
        pet.y = PET_FEET - lift;
        pet.visible = !p.absent;
        if (!p.covered) {
          if (feedWaiting >= 0) {
            if (now - feedWaiting < 30_000) feedAt = now;
            feedWaiting = -1;
          }
          if (playWaiting >= 0) {
            if (now - playWaiting < 30_000) {
              playAt = now;
              hopAt = now;
            }
            playWaiting = -1;
          }
        }
        const busyCare = (p.lastCare !== null && now - p.lastCare.at < 2600) || feedAt >= 0 || playAt >= 0;
        const head = PET_FEET - HEAD[p.stage];

        // play: a ball bounces back and forth and the pet keeps its eyes on it
        if (playAt >= 0) {
          const k = (now - playAt) / 2600;
          if (k > 1) {
            playAt = -1;
            ball.visible = false;
          } else {
            const bx = PET_X + Math.sin(k * Math.PI * 3) * 26;
            const bh = Math.abs(Math.sin(k * Math.PI * 7)) * 16 * (1 - k * 0.5);
            ball.visible = true;
            ball.x = Math.round(bx);
            ball.y = Math.round(PET_FEET - 3 - bh);
            pet.scale.x = bx < PET_X ? -1 : 1;
            if (hopAt < 0 && Math.random() < 0.03) hopAt = now;
          }
        } else if (!p.asleep && !busyCare && Math.abs(lookX - PET_X) > 8 && !pose?.face) {
          // otherwise it turns toward your pointer
          pet.scale.x = lookX < PET_X ? -1 : 1;
        }

        // feed: the food arcs into its mouth, then shrinks bite by bite with crumbs
        if (feedAt >= 0) {
          const k = (now - feedAt) / 1400;
          if (k > 1) {
            feedAt = -1;
            food.visible = false;
          } else if (food.texture && food.texture.width > 1) {
            const mx = PET_X + pet.scale.x * 3;
            const my = PET_FEET - Math.round(HEAD[p.stage] * 0.42);
            food.visible = true;
            if (k < 0.4) {
              const t = k / 0.4;
              food.x = Math.round(mx + 30 * (1 - t));
              food.y = Math.round(my - 34 * (1 - t) * (1 - t) - 8 * Math.sin(t * Math.PI));
              food.alpha = 1;
              food.scale.set(foodScale);
            } else {
              const bite = (k - 0.4) / 0.6;
              food.x = mx;
              food.y = my;
              food.alpha = 1 - bite * 0.9;
              food.scale.set(foodScale * (1 - bite * 0.75));
              if (Math.random() < 0.3) {
                const c = new Sprite(BITS.crumb(Math.random() < 0.5 ? "#FFFDF8" : "#FFC83D"));
                c.x = mx + (Math.random() * 6 - 3);
                c.y = my + 2;
                fx.addChild(c);
                particles.push({ s: c, vx: (Math.random() - 0.5) * 0.5, vy: -0.4, life: 0.8, g: 0.06 });
              }
            }
          }
        }

        // G1: the living room's event, for five seconds from the beat that brought it
        const ev = p.event ?? 0;
        const ek = p.eventAt !== undefined ? (now - p.eventAt) / 5000 : 2;
        const showing = ev !== 0 && ek >= 0 && ek < 1 && !p.covered;
        // a toy rolls in from the left and comes to rest beside the pet
        visitorToy.visible = showing && ev === 2;
        if (visitorToy.visible) {
          const roll = Math.min(1, ek * 3.5);
          visitorToy.x = Math.round(PET_X - 70 + roll * 52);
          visitorToy.y = Math.round(PET_FEET - 1 - Math.abs(Math.sin(roll * Math.PI * 3)) * 6 * (1 - roll));
        }
        // a friend wanders up from the right and stops a little way off
        visitorFriend.visible = showing && ev === 1;
        if (visitorFriend.visible) {
          const walk = Math.min(1, ek * 2.5);
          visitorFriend.texture = BITS.friend(walk < 1 && Math.floor(now / 180) % 2 === 0);
          visitorFriend.x = Math.round(PET_X + 70 - walk * 44);
          visitorFriend.y = PET_FEET - 1;
        }
        // a noise: a red "!" over its head, and a startle
        alarm.visible = showing && ev === 3 && Math.floor(now / 250) % 2 === 0;
        alarm.x = PET_X - 12;
        alarm.y = head - 4;
        if (showing && ev === 3 && ek < 0.12 && !p.reduceMotion) pet.x = PET_X + (Math.floor(now / 40) % 2 ? 1 : -1);
        // the light bulb of a taught lesson deciding
        bulb.visible = !!p.taught && !p.asleep && !p.covered;
        bulb.x = PET_X;
        bulb.y = head - 4 + (p.reduceMotion ? 0 : Math.round(Math.sin(now / 300)));

        // hungry: a little thought of food above its head
        const hungry = (p.want === 1 || p.food < 250) && !p.asleep && !busyCare && (p.reduceMotion || Math.floor(now / 2600) % 2 === 0);
        thought.visible = hungry;
        thoughtFood.visible = hungry && thoughtFood.texture.width > 1;
        thought.x = PET_X + 14;
        thought.y = head - 2;
        thoughtFood.x = thought.x;
        thoughtFood.y = thought.y - 8;

        // asleep: zzz drift up; very happy: a note now and then
        if (p.asleep && !p.reduceMotion && now - lastZ > 1100) {
          lastZ = now;
          const z = new Sprite(BITS.z());
          z.anchor.set(0.5);
          z.x = PET_X + 9;
          z.y = head;
          fx.addChild(z);
          particles.push({ s: z, vx: 0.08, vy: -0.16, life: 1 });
        }
        if (p.mood === 3 && !p.asleep && !busyCare && !p.reduceMotion && Math.random() < 0.005) burst("note", 1, ["#2F7FD6"]);

        // dust bunnies gather when it hasn't been cleaned in a while
        bunnies[0]!.visible = p.clean < 300;
        bunnies[1]!.visible = p.clean < 150;
        bunnies.forEach((b, i) => {
          b.texture = BITS.bunny(!p.reduceMotion && Math.floor(now / 2300 + i * 3) % 6 === 0);
          b.y = PET_FEET + 3 + (!p.reduceMotion && Math.sin(now / 480 + i * 2) > 0.4 ? -1 : 0);
        });

        // the light breathes a little; it is warm and gold in the evening, cool and low at night
        const lightAlpha = p.phase === "night" ? 0.22 : p.phase === "evening" ? 0.18 : 0;
        glow.alpha += (lightAlpha * (p.reduceMotion ? 1 : 0.92 + 0.08 * Math.sin(now / 900)) - glow.alpha) * 0.08;
        glow.tint = p.phase === "night" ? 0xffb85c : 0xffa45a;
        glow.x = PET_X;
        glow.y = PET_FEET - 14;
        glow.width = glow.height = 80;
        vignette.alpha = p.phase === "night" ? 0.42 : p.phase === "evening" ? 0.3 : 0.16;
        const dark = p.asleep && !p.absent ? LIGHTS_OUT : 0;
        lightsOut.alpha = p.reduceMotion ? dark : lightsOut.alpha + (dark - lightsOut.alpha) * 0.06;
        // depth: the drifting motes and weather lean a pixel toward the pointer, ahead of the still room
        if (!p.reduceMotion) sky.x = Math.round(Math.max(-1, Math.min(1, (lookX - PET_X) / 40)) * 2);

        // motes in the light, fireflies at night, and today's weather outdoors
        if (!p.reduceMotion) {
          const ambient: Drift["kind"] = p.phase === "night" ? "firefly" : "mote";
          const wanted: Array<[Drift["kind"], number]> = [[ambient, p.phase === "night" ? 7 : 4]];
          if (p.outdoors && weather === "rain") wanted.push(["drop", 34]);
          if (p.outdoors && weather === "snow") wanted.push(["flake", 24]);
          if (p.outdoors && (weather === "petals" || weather === "leaves")) wanted.push(["petal", 9]);
          for (const [kind, count] of wanted) {
            const have = drifts.filter((d) => d.kind === kind).length;
            if (have < count && Math.random() < 0.2) {
              const tex =
                kind === "firefly" ? BITS.firefly()
                : kind === "mote" ? BITS.mote(p.phase === "evening" ? "#FFB86B" : "#FFF7D6")
                : kind === "drop" ? BITS.drop()
                : kind === "flake" ? BITS.flake()
                : BITS.petal(weather === "leaves" ? (Math.random() < 0.5 ? "#E8803A" : "#C9542F") : Math.random() < 0.5 ? "#FFB3C7" : "#FFD9E2");
              const s = new Sprite(tex);
              s.anchor.set(0.5);
              s.x = Math.random() * ROOM;
              s.y = kind === "firefly" || kind === "mote" ? 40 + Math.random() * 70 : -4 - Math.random() * 30;
              s.alpha = kind === "drop" ? 0.6 : kind === "mote" ? 0.7 : 1;
              sky.addChild(s);
              const d: Drift = {
                s,
                kind,
                vx: kind === "drop" ? 0.45 : kind === "petal" ? 0.25 : (Math.random() - 0.5) * 0.12,
                vy: kind === "drop" ? 2.4 : kind === "flake" ? 0.22 + Math.random() * 0.12 : kind === "petal" ? 0.3 : -0.04 - Math.random() * 0.05,
                ph: Math.random() * 6.28,
              };
              drifts.push(d);
            }
          }
          for (let i = drifts.length - 1; i >= 0; i--) {
            const d = drifts[i]!;
            d.ph += 0.03;
            d.s.x += d.vx + (d.kind === "flake" || d.kind === "petal" ? Math.sin(d.ph) * 0.18 : d.kind === "firefly" ? Math.sin(d.ph * 0.7) * 0.15 : 0);
            d.s.y += d.vy + (d.kind === "firefly" ? Math.cos(d.ph * 0.9) * 0.08 : 0);
            if (d.kind === "firefly") d.s.alpha = 0.35 + 0.65 * Math.max(0, Math.sin(d.ph * 1.6));
            const gone = d.s.y > ROOM + 4 || d.s.y < 30 || d.s.x < -6 || d.s.x > ROOM + 6;
            const stale = !wanted.some(([k]) => k === d.kind);
            if (gone || stale) {
              d.s.destroy();
              drifts.splice(i, 1);
            }
          }
        }

        // the cat lives its own life
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
            else if (catState.mode === "walk") catState.mode = r < napChance ? "nap" : r < napChance + 0.15 ? "groom" : "sit";
            else {
              catState.mode = "walk";
              if (Math.random() < 0.5) catState.dir *= -1;
            }
            catState.until = now + (catState.mode === "nap" ? 9000 : catState.mode === "walk" ? 6000 : 3500) + Math.random() * 4000;
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

        // other players' pets
        const others = p.others;
        const seen = new Set<string>();
        for (const o of others) {
          seen.add(o.id);
          let v = visitors.get(o.id);
          if (!v) {
            const sprite = new Sprite();
            sprite.anchor.set(0.5, 1);
            sprite.eventMode = "static";
            sprite.cursor = "pointer";
            sprite.hitArea = bodyHitArea(sprite);
            sprite.on("pointertap", () => latest.current.onOtherTap(o.id));
            world.addChildAt(sprite, world.getChildIndex(pet));
            const tag = new Text({ text: o.name, style: { fontFamily: "Baloo 2 Variable, sans-serif", fontWeight: "800", fontSize: 12, fill: "#2B2140", stroke: { color: "#FFF7E8", width: 4 } } });
            tag.anchor.set(0.5, 1);
            const bubble = new Text({ text: "", style: { fontFamily: "Baloo 2 Variable, sans-serif", fontWeight: "700", fontSize: 13, fill: "#2B2140", wordWrap: true, wordWrapWidth: 150, align: "center" } });
            bubble.anchor.set(0.5, 1);
            const bubbleBg = new Graphics();
            ui.addChild(tag, bubbleBg, bubble);
            const lane = o.look ? o.look.x : laneOf(o.id);
            const home = residentSpot.get(o.id) ?? floorSpot(lane, view, halfOf(o.stage));
            v = { sprite, tag, bubble, bubbleBg, x: home, target: home, lane, lastEmote: 0 };
            visitors.set(o.id, v);
          }
          // a resident keeps to its spot, visitors wander near their lane; every pet stands within what shows, which moves
          // when the view is resized (A69)
          if (!o.look && !p.reduceMotion && Math.random() < 0.004) v.lane = Math.max(WANDER.min, Math.min(WANDER.max, laneOf(o.id) + (Math.random() * 24 - 12)));
          v.target = residentSpot.get(o.id) ?? floorSpot(o.look ? o.look.x : v.lane, view, halfOf(o.stage));
          if (Math.abs(v.target - v.x) > 0.5) v.x += Math.sign(v.target - v.x) * 0.15;
          const stageName = o.stage === "elder" ? "adult" : o.stage;
          const expr = o.mood === 3 ? "sparkly" : o.mood === 2 ? "happy" : o.mood === 0 ? "sulk" : "neutral";
          v.sprite.texture = petTexture((["gentle", "bold", "curious"].includes(o.line) ? o.line : "gentle") as SceneProps["line"], {
            stage: (["baby", "child", "teen", "adult"].includes(stageName) ? stageName : "baby") as PetStage,
            expression: (o.emote && now - o.emote.at < 2000 ? (o.emote.kind === "heart" ? "love" : "happy") : expr) as Expression,
            breath: p.reduceMotion ? 0 : Math.sin(now / 640 + v.x) > 0.35 ? 1 : 0,
            squash: 0,
            lit: !!o.look?.lit,
            ...(o.look ? { palette: o.look.palette, outfit: o.look.outfitAt(Date.now()) } : {}),
          });
          v.sprite.scale.x = v.target < v.x ? -1 : 1;
          v.sprite.x = Math.round(v.x);
          v.sprite.y = PET_FEET + 2;
          if (o.emote && o.emote.at !== v.lastEmote) {
            v.lastEmote = o.emote.at;
            const kind = o.emote.kind === "heart" || o.emote.kind === "gift" ? "heart" : o.emote.kind === "laugh" || o.emote.kind === "dance" ? "note" : "spark";
            for (let i = 0; i < 4; i++) {
              const sp = new Sprite(glyphTexture(kind, i % 2 ? "#FFC83D" : "#FF7A9A"));
              sp.anchor.set(0.5);
              sp.x = v.x + (Math.random() * 12 - 6);
              sp.y = PET_FEET - 26;
              fx.addChild(sp);
              particles.push({ s: sp, vx: (Math.random() - 0.5) * 0.25, vy: -0.32, life: 1 });
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
            v.bubbleBg.moveTo(tail - 5, y0 + h).lineTo(tail, y0 + h + 6).lineTo(tail + 5, y0 + h).fill({ color: 0xfffdf8 });
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

        for (let i = particles.length - 1; i >= 0; i--) {
          const q = particles[i]!;
          q.vy += q.g ?? 0;
          q.s.x += q.vx;
          q.s.y += q.vy;
          q.life -= 0.016;
          q.s.alpha = Math.min(1, q.life * 1.6);
          if (q.life <= 0) {
            q.s.removeFromParent();
            q.s.destroy();
            particles.splice(i, 1);
          }
        }
      };
      app.ticker.add(tick);
      // the room answers taps once its first frame has drawn the pet (its body is what a tap is tested against)
      app.ticker.addOnce(() => (el.dataset.ready = "1"));
      const onVis = () => (document.hidden ? app.ticker.stop() : app.ticker.start());
      document.addEventListener("visibilitychange", onVis);
      cleanup = () => {
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVis);
      };
    })();

    return () => {
      disposed = true;
      cleanup();
      // if init is still running, it destroys the app itself when it finishes
      if (ready) destroyApp();
    };
  }, []);

  return <div ref={host} className="room-scene" />;
}
