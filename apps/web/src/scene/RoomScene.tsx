/**
 * The pet's room, drawn with PixiJS. The 128×128 room art is scaled by
 * a whole number to fill the box (crisp, never blurred); the pet stands on the
 * floor and lives on its own; a resident cat wanders the front edge.
 *
 * React owns the props; the Pixi ticker reads the latest values through a ref,
 * so the scene never rebuilds on a state change.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { Application, Container, Sprite } from "pixi.js";
// the site sends a script policy without eval; this module gives Pixi the code paths that never need it
import "pixi.js/unsafe-eval";
import type { StarterLine } from "@lingxi/brain";
import { type PetStage } from "./textures";
import { PET_HOME, ROOM, roomOrigin, type FloorView } from "./floor";
import { bodyHitArea } from "./hitArea";
import { createBackground } from "./background";
import { createCat } from "./cat";
import { createCharacter } from "./character";
import { createDecor } from "./decor";
import { createDrifts } from "./drifts";
import { createLighting } from "./lighting";
import { createParticles } from "./particles";
import { createPetLife } from "./petLife";
import { placeResident } from "./residentSpot";
import { makeBg } from "./roomArt";
import { createVisitors } from "./visitors";

export type { DayPhase } from "./dayPhase";
import type { DayPhase } from "./dayPhase";

export { type Weather, weatherFor } from "./weather";
import { weatherFor } from "./weather";

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
      // the room's picture, still or moving, swapped when the time of day changes
      const background = createBackground(world, first, latest.current.bgs[latest.current.phase]);
      const shadeLayer = new Container();
      world.addChild(shadeLayer);
      shadeLayer.eventMode = "none";
      // the room's character stands to the right, behind the pets, with its quest mark over its head
      const character = createCharacter(world, () => latest.current.onNpcTap());
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
      // decorations: pieces standing behind the pet's feet go behind it, the rest in front
      const decorBack = new Container();
      world.addChildAt(decorBack, world.getChildIndex(cat.sprite));
      const decorFront = new Container();
      world.addChild(decorFront);
      const decor = createDecor(decorBack, decorFront, {
        decorating: () => latest.current.decorating,
        onTap: (id) => latest.current.onDecorTap(id),
      });
      const props = new Container();
      world.addChild(props);
      props.eventMode = "none";
      const fx = new Container();
      world.addChild(fx);
      const sky = new Container();
      world.addChild(sky);
      fx.eventMode = "none";
      sky.eventMode = "none";
      // the light: a warm pool around the pet at dusk and night, soft corners always, lights out while it sleeps
      const lighting = createLighting(world, { under: floor, below: fx });
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

      const petLife = createPetLife({
        pet,
        floor,
        props,
        particles,
        latest: () => latest.current,
      });

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
        decor.update(p.decor);
        background.update(p);
        character.update(now, p);
        petLife.update(now, p, PET_X, lookX);

        lighting.update(now, p, PET_X);
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
