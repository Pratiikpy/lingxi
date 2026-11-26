/**
 * The landing page's living hero: a pixel landscape scaled by a whole
 * number to cover the band (day, evening or night by the visitor's clock), a
 * Lingxi pet that wanders, hops when tapped and walks to where you tap, and the
 * resident cat on the front edge. Pauses when the tab is hidden; still when the
 * visitor prefers reduced motion.
 */

import type { HeroPhase } from "./heroPhase";
import { useEffect, useRef } from "react";
import { Application, Assets, Container, Sprite, type Texture } from "pixi.js";
// the site sends a script policy without eval; this module gives Pixi the code paths that never need it
import "pixi.js/unsafe-eval";
import { BG, GROUND, PET_AT, ROOM, heroScale, isNarrowBand } from "./heroArt";
import { catTexture, glyphTexture, petTexture } from "../scene/textures";

export { type HeroPhase, phaseNow } from "./heroPhase";

export function HeroScene({ reduceMotion, phase }: { reduceMotion: boolean; phase: HeroPhase }) {
  const host = useRef<HTMLDivElement>(null);
  // switching day, dusk and night swaps the landscape without rebuilding the scene
  const swap = useRef<((p: HeroPhase) => void) | null>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
    swap.current?.(phase);
  }, [phase]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let ready = false;
    let cleanup = () => {};
    const app = new Application();
    (async () => {
      // P3: the scene starts once the browser is idle after the first paint (at most 1.5 s later), so the headline and
      // its buttons are drawn and answer taps before the animation's setup runs
      await new Promise<void>((r) =>
        "requestIdleCallback" in window ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 200),
      );
      if (disposed) return;
      await app.init({
        backgroundAlpha: 0,
        antialias: false,
        resizeTo: el,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      ready = true;
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      el.appendChild(app.canvas);
      app.canvas.classList.add("pixel");
      let bg: Texture = await Assets.load(BG[phaseRef.current]);
      bg.source.scaleMode = "nearest";
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      const world = new Container();
      app.stage.addChild(world);
      // the room tiles across the band, every other copy mirrored so edges meet cleanly
      const tiles = new Container();
      world.addChild(tiles);
      const cat = new Sprite(catTexture("sit0"));
      cat.anchor.set(0.5, 1);
      world.addChild(cat);
      const pet = new Sprite();
      pet.anchor.set(0.5, 1);
      pet.eventMode = "static";
      pet.cursor = "pointer";
      world.addChild(pet);
      const fx = new Container();
      world.addChild(fx);

      // the band shows the lower part of the scene; scale covers the width
      let scale = 1;
      let ground = GROUND;
      let span = ROOM;
      const layout = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        scale = heroScale(h);
        world.scale.set(scale);
        const need = Math.ceil(w / (ROOM * scale)) + 1;
        tiles.removeChildren().forEach((c) => c.destroy());
        for (let i = 0; i < need; i++) {
          const t = new Sprite(bg);
          if (i % 2 === 1) {
            t.scale.x = -1;
            t.x = (i + 1) * ROOM;
          } else t.x = i * ROOM;
          tiles.addChild(t);
        }
        span = Math.ceil(w / scale);
        world.x = 0;
        world.y = Math.round(h - ROOM * scale);
        ground = GROUND;
      };
      layout();
      swap.current = (p) => {
        void Assets.load(BG[p]).then((t: Texture) => {
          if (disposed) return;
          t.source.scaleMode = "nearest";
          bg = t;
          for (const c of tiles.children) (c as Sprite).texture = t;
        });
      };
      const ro = new ResizeObserver(layout);
      ro.observe(el);

      const state = { x: 0, target: 0, dir: 1, hopAt: -1, nextWander: performance.now() + 2500 };
      const catState = { x: 30, dir: 1, mode: "walk" as "walk" | "sit" | "nap", until: performance.now() + 6000 };
      state.x = state.target = Math.round(span * PET_AT);
      catState.x = Math.round(span * 0.22);
      const hearts: Array<{ s: Sprite; vy: number; life: number }> = [];
      pet.on("pointertap", () => {
        state.hopAt = performance.now();
        for (let i = 0; i < 4; i++) {
          const s = new Sprite(glyphTexture("heart", i % 2 ? "#FFC83D" : "#FF7A9A"));
          s.anchor.set(0.5);
          s.x = state.x + (Math.random() * 14 - 7);
          s.y = ground - 30;
          fx.addChild(s);
          hearts.push({ s, vy: -0.35 - Math.random() * 0.2, life: 1 });
        }
      });
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointertap", (e) => {
        if (e.target === pet) return;
        const local = world.toLocal(e.global);
        state.target = Math.max(16, Math.min(span - 16, local.x));
      });

      let blinkAt = performance.now() + 1500;
      const tick = () => {
        const now = performance.now();
        // movement is per 60th of a second, scaled by the frames that passed (the ticker runs at 30, P3)
        const frames = Math.min(4, app.ticker.deltaTime);
        if (!reduceMotion) {
          if (now > state.nextWander && Math.abs(state.target - state.x) < 1) {
            // wander on either side of the middle, where the headline's buttons sit
            const side = Math.random() < 0.5 ? 0 : 1;
            const lo = side ? span * 0.66 : 24;
            const hi = side ? span - 24 : span * 0.34;
            state.target = lo + Math.random() * Math.max(0, hi - lo);
            state.nextWander = now + 4000 + Math.random() * 5000;
          }
          const dx = state.target - state.x;
          if (Math.abs(dx) > 0.5) {
            state.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.22 * frames);
            state.dir = Math.sign(dx);
          }
        }
        if (now > blinkAt) blinkAt = now + 2400 + Math.random() * 2400;
        const blinking = now > blinkAt - 140;
        const walking = Math.abs(state.target - state.x) > 0.5 && !reduceMotion;
        let squash: -1 | 0 | 1 = 0;
        let lift = walking ? Math.floor(now / 160) % 2 : 0;
        if (state.hopAt >= 0) {
          const k = (now - state.hopAt) / 520;
          if (k > 1) state.hopAt = -1;
          else if (k < 0.16 || k > 0.84) squash = -1;
          else {
            squash = 1;
            lift = Math.round(Math.sin(((k - 0.16) / 0.68) * Math.PI) * 7);
          }
        }
        const breath: 0 | 1 = reduceMotion ? 0 : Math.sin(now / 620) > 0.35 ? 1 : 0;
        pet.texture = petTexture("gentle", {
          // on a phone's band the pet is the child its stage is measured for (heroArt.isNarrowBand, R28)
          stage: isNarrowBand(el.clientWidth) ? "child" : "adult",
          expression: state.hopAt >= 0 ? "love" : blinking ? "asleep" : walking ? "happy" : "neutral",
          breath,
          squash,
          lit: state.hopAt >= 0,
        });
        pet.scale.x = state.dir;
        pet.x = Math.round(state.x);
        pet.y = ground - lift;

        if (!reduceMotion) {
          if (catState.mode === "walk") {
            catState.x += catState.dir * 0.16 * frames;
            if (catState.x > span - 10 || catState.x < 10) catState.dir *= -1;
          }
          if (now > catState.until) {
            catState.mode = catState.mode === "walk" ? (Math.random() < 0.35 ? "nap" : "sit") : "walk";
            catState.until = now + (catState.mode === "nap" ? 9000 : 4500) + Math.random() * 4000;
          }
        }
        const step = Math.floor(now / 170) % 2;
        cat.texture = catTexture(
          catState.mode === "walk"
            ? step
              ? "walk1"
              : "walk0"
            : catState.mode === "nap"
              ? "nap"
              : (["sit0", "sit1", "sit2"] as const)[Math.floor(now / 380) % 3]!,
        );
        cat.scale.x = catState.dir;
        cat.x = Math.round(catState.x);
        cat.y = ground + 5;
        for (let i = hearts.length - 1; i >= 0; i--) {
          const h = hearts[i]!;
          h.s.y += h.vy * frames;
          h.life -= 0.016 * frames;
          h.s.alpha = Math.min(1, h.life * 1.6);
          if (h.life <= 0) {
            h.s.removeFromParent();
            h.s.destroy();
            hearts.splice(i, 1);
          }
        }
      };
      // P3: a pixel-art scene reads the same at 30 frames a second, at half the main-thread time on a phone
      app.ticker.maxFPS = 30;
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
      swap.current = null;
      cleanup();
      if (ready) app.destroy(true, { children: true });
    };
  }, [reduceMotion]);
  return <div ref={host} className="hero-scene" aria-hidden="true" />;
}
