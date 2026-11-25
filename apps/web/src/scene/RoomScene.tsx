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
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
// the site sends a script policy without eval; this module gives Pixi the code paths that never need it
import "pixi.js/unsafe-eval";
import type { Expression } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";
import { DECOR_BY_ID } from "@lingxi/world";
import { BITS, type PetStage, glowTexture, petTexture, pixelTexture, vignetteTexture } from "./textures";
import { PET_FEET, PET_HOME, ROOM, roomOrigin, type FloorView } from "./floor";
import { bodyHitArea } from "./hitArea";
import { createCat } from "./cat";
import { createDrifts } from "./drifts";
import { createParticles } from "./particles";
import { placeResident } from "./residentSpot";
import { bgTexture, drawMark, makeBg } from "./roomArt";
import { createVisitors } from "./visitors";

export type { DayPhase } from "./dayPhase";
import type { DayPhase } from "./dayPhase";

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
    look?: {
      palette: { key: string; colors: import("@lingxi/art").Palette };
      outfitAt: (ms: number) => import("@lingxi/art").Outfit;
      x: number;
      lit?: boolean;
    };
  }>;
  onOtherTap: (id: string) => void;
  /** the character standing in this room (portrait file), if any */
  npc: string | null;
  /** over the character's head: "!" when they have a quest for you, "✓" when one is ready to hand in */
  npcMark?: "!" | "✓" | "★" | null;
  onNpcTap: () => void;
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
      await app.init({
        backgroundAlpha: 0,
        antialias: false,
        resizeTo: el,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
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
      // the cat lives its own life along the hut's doorstep, behind the pet
      const cat = createCat(world);
      const pet = new Sprite();
      pet.anchor.set(0.5, 1);
      pet.eventMode = "static";
      pet.cursor = "pointer";
      pet.hitArea = bodyHitArea(pet);
      world.addChild(pet);
      // living details: dust bunnies on the floor behind the cat and pet; the food, the ball and
      // the "hungry" thought in front of the pet; drifting motes and weather over everything
      const floor = new Container();
      world.addChildAt(floor, world.getChildIndex(cat.sprite));
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
      world.addChildAt(decorBack, world.getChildIndex(cat.sprite));
      const decorFront = new Container();
      world.addChild(decorFront);
      let shownDecor = "";
      const showDecor = (list: SceneProps["decor"]) => {
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
      // motes in the light, fireflies at night, and today's weather outdoors
      const drifts = createDrifts(sky, weatherFor(new Date()));
      // where the pet stands this frame: the room's middle, or beside a resident when the visible floor is narrow
      let PET_X = PET_HOME;
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
      /** the part of the room that shows (a phone crops the sides), in room pixels */
      const view: FloorView = { left: 0, right: ROOM };

      let scale = 1;
      const layout = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        // the largest whole-number scale that covers the box, cropped evenly with the pet kept above the thinking
        // strip (floor.ts roomOrigin, which the browser tests tap from too)
        const origin = roomOrigin(w, h);
        scale = origin.scale;
        world.scale.set(scale);
        world.x = origin.x;
        world.y = origin.y;
      };
      layout();
      const ro = new ResizeObserver(layout);
      ro.observe(el);

      const particles = createParticles(fx);
      const visitors = createVisitors({
        world,
        ui,
        el,
        petSprite: pet,
        particles,
        onTap: (id) => latest.current.onOtherTap(id),
      });

      let hopAt = -1;
      pet.on("pointertap", (e) => {
        if (latest.current.decorating) return;
        e.stopPropagation();
        latest.current.onPetTap();
        if (!latest.current.asleep && !latest.current.reduceMotion) hopAt = performance.now();
        if (!latest.current.asleep) particles.burst("heart", 5, ["#FF7A9A", "#FFC83D"], PET_X);
      });

      let lastCareAt = -1;
      let blinkAt = performance.now() + 1500;
      let shownBg = latest.current.bgs[latest.current.phase];

      const tick = () => {
        const now = performance.now();
        const p = latest.current;
        view.left = Math.max(0, -world.x / scale);
        view.right = Math.min(ROOM, view.left + el.clientWidth / scale);
        const resident = p.others.find((o) => o.look);
        const placed = placeResident(
          resident?.look ? { id: resident.id, stage: resident.stage, x: resident.look.x } : null,
          p.stage,
          view,
        );
        PET_X = placed.petX;
        const spot = placed.spot;
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
        if (p.sick && !p.asleep && !p.reduceMotion && Math.random() < 0.012)
          particles.burst("spark", 1, ["#7BD389", "#5FB46F"], PET_X);
        if (p.lastCare && p.lastCare.at !== lastCareAt) {
          lastCareAt = p.lastCare.at;
          if (p.lastCare.kind === "feed") {
            particles.burst("heart", 3, ["#FF7A9A"], PET_X);
            // the food arcs in from the side, then gets eaten bite by bite
            const art = p.lastCare.food;
            if (art && !p.reduceMotion) {
              feedWaiting = now;
              food.visible = false;
              void bgTexture(art.startsWith("/") ? art : `/${art}`).then((t) => {
                if (food.destroyed) return;
                food.texture = t;
                foodScale =
                  { baby: 8, child: 10, teen: 12, adult: 13 }[latest.current.stage] / Math.max(t.width, t.height);
                food.scale.set(foodScale);
              });
            }
          }
          if (p.lastCare.kind === "clean") particles.burst("spark", 8, ["#FFFFFF", "#FFC83D"], PET_X);
          if (p.lastCare.kind === "play") {
            particles.burst("note", 3, ["#2F7FD6"], PET_X);
            if (!p.reduceMotion) playWaiting = now;
          }
        }
        if (now > blinkAt) blinkAt = now + 2400 + Math.random() * 2400;
        const blinking = now > blinkAt - 140;
        const face = expressionFor(p, now, blinking);
        let e = face.e;
        const lit = face.lit;
        let squash: -1 | 0 | 1 = 0;
        let lift = 0;
        // D6: a small habit while its circuit chooses to rest (habitPose: timed by the clock, never at random)
        const resting =
          !p.asleep && !p.sick && p.want === 0 && !(p.lastCare && now - p.lastCare.at < 2600) && !p.reduceMotion;
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
        pet.texture = petTexture(p.line, {
          stage: p.stage,
          expression: e,
          breath,
          squash,
          lit,
          ...(p.form ? { form: p.form } : {}),
          ...(p.outfit ? { outfit: p.outfit } : {}),
        });
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
                particles.add({ s: c, vx: (Math.random() - 0.5) * 0.5, vy: -0.4, life: 0.8, g: 0.06 });
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
        const hungry =
          (p.want === 1 || p.food < 250) &&
          !p.asleep &&
          !busyCare &&
          (p.reduceMotion || Math.floor(now / 2600) % 2 === 0);
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
          particles.add({ s: z, vx: 0.08, vy: -0.16, life: 1 });
        }
        if (p.mood === 3 && !p.asleep && !busyCare && !p.reduceMotion && Math.random() < 0.005)
          particles.burst("note", 1, ["#2F7FD6"], PET_X);

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

        drifts.update(p);

        cat.update(now, p);

        // other players' pets
        visitors.update(now, p, view, spot, scale);

        particles.update();
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
