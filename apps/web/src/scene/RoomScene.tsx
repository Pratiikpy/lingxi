/**
 * The pet's room, drawn with PixiJS. the source game's 128×128 room art is scaled by
 * a whole number to fill the box (crisp, never blurred); the pet stands on the
 * floor and lives on its own; a resident cat wanders the front edge.
 *
 * React owns the props; the Pixi ticker reads the latest values through a ref,
 * so the scene never rebuilds on a state change.
 */

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Sprite, type Texture } from "pixi.js";
import type { Expression } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";
import { type PetStage, catTexture, glyphTexture, petTexture } from "./textures";

export type DayPhase = "day" | "evening" | "night";

export interface SceneProps {
  line: StarterLine;
  stage: PetStage;
  asleep: boolean;
  want: number;
  mood: number;
  phase: DayPhase;
  /** performance.now() of the last care and what it was */
  lastCare: { kind: string; at: number } | null;
  onPetTap: () => void;
  reduceMotion: boolean;
  /** the current room's backgrounds */
  bgs: { day: string; evening: string; night: string };
}

const ROOM = 128;
const bgCache = new Map<string, Texture>();
async function bgTexture(url: string): Promise<Texture> {
  const hit = bgCache.get(url);
  if (hit) return hit;
  const t: Texture = await Assets.load(url);
  t.source.scaleMode = "nearest";
  bgCache.set(url, t);
  return t;
}
const PET_X = 64;
const PET_FEET = 104;
const CAT_FEET = 96;

interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
}

function expressionFor(p: SceneProps, now: number, blinking: boolean): { e: Expression; lit: boolean } {
  const care = p.lastCare && now - p.lastCare.at < 2600 ? p.lastCare.kind : null;
  if (p.asleep) return { e: "asleep", lit: false };
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

export function RoomScene(props: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let ready = false;
    const app = new Application();
    let cleanup = () => {};

    (async () => {
      await app.init({ backgroundAlpha: 0, antialias: false, resizeTo: el, autoDensity: true, resolution: window.devicePixelRatio || 1 });
      ready = true;
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      el.appendChild(app.canvas);
      app.canvas.classList.add("pixel");
      app.canvas.style.display = "block";

      const first = await bgTexture(latest.current.bgs[latest.current.phase]);
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }

      const world = new Container();
      app.stage.addChild(world);
      const room = new Sprite(first);
      world.addChild(room);
      const shadeLayer = new Container();
      world.addChild(shadeLayer);
      // the cat's lane runs behind the pet, along the hut's doorstep
      const cat = new Sprite(catTexture("sit0"));
      cat.anchor.set(0.5, 1);
      cat.eventMode = "static";
      cat.cursor = "pointer";
      world.addChild(cat);
      const pet = new Sprite();
      pet.anchor.set(0.5, 1);
      pet.eventMode = "static";
      pet.cursor = "pointer";
      world.addChild(pet);
      const fx = new Container();
      world.addChild(fx);

      let scale = 1;
      const layout = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        // the largest whole-number scale that covers the box, cropped evenly
        scale = Math.max(1, Math.ceil(Math.max(w, h) / ROOM));
        world.scale.set(scale);
        world.x = Math.round((w - ROOM * scale) / 2);
        world.y = Math.round((h - ROOM * scale) / 2);
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
      pet.on("pointertap", () => {
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
        const wantBg = p.bgs[p.phase];
        if (wantBg !== shownBg) {
          shownBg = wantBg;
          void bgTexture(wantBg).then((tex) => {
            if (shownBg === wantBg && !room.destroyed) room.texture = tex;
          });
        }
        if (p.lastCare && p.lastCare.at !== lastCareAt) {
          lastCareAt = p.lastCare.at;
          if (p.lastCare.kind === "feed") burst("heart", 3, ["#FF7A9A"]);
          if (p.lastCare.kind === "clean") burst("spark", 8, ["#FFFFFF", "#FFC83D"]);
          if (p.lastCare.kind === "play") {
            burst("note", 3, ["#2F7FD6"]);
            if (!p.reduceMotion) hopAt = now;
          }
        }
        if (now > blinkAt) blinkAt = now + 2400 + Math.random() * 2400;
        const blinking = now > blinkAt - 140;
        const { e, lit } = expressionFor(p, now, blinking);
        let squash: -1 | 0 | 1 = 0;
        let lift = 0;
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
        pet.texture = petTexture(p.line, { stage: p.stage, expression: e, breath, squash, lit });
        pet.x = PET_X;
        pet.y = PET_FEET - lift;

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

        for (let i = particles.length - 1; i >= 0; i--) {
          const q = particles[i]!;
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
      if (ready) app.destroy(true, { children: true });
    };
  }, []);

  return <div ref={host} className="room-scene" />;
}
