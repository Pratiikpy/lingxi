/**
 * The pet's room, drawn with PixiJS. The 128×128 room art is scaled by
 * a whole number to fill the box (crisp, never blurred); the pet stands on the
 * floor and lives on its own; a resident cat wanders the front edge.
 *
 * React owns the props; the Pixi ticker reads the latest values through a ref,
 * so the scene never rebuilds on a state change.
 */

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { AnimatedGIF } from "@pixi/gif";
import type { Expression } from "@lingxi/art";
import type { StarterLine } from "@lingxi/brain";
import { type PetStage, catTexture, glyphTexture, petTexture } from "./textures";

export type DayPhase = "day" | "evening" | "night";

export interface SceneProps {
  line: StarterLine;
  stage: PetStage;
  asleep: boolean;
  /** ill from neglect: dizzy face and little green swirls */
  sick: boolean;
  want: number;
  mood: number;
  phase: DayPhase;
  /** performance.now() of the last care and what it was */
  lastCare: { kind: string; at: number } | null;
  onPetTap: () => void;
  reduceMotion: boolean;
  /** the current room's backgrounds */
  bgs: { day: string; evening: string; night: string };
  /** other players' pets here right now */
  others: Array<{ id: string; name: string; line: string; stage: string; mood: number; emote?: { kind: string; at: number }; say?: { text: string; at: number } }>;
  onOtherTap: (id: string) => void;
  /** the character standing in this room (portrait file), if any */
  npc: string | null;
  onNpcTap: () => void;
}

/** A stable spot on the floor for a visitor, from their id. */
function spotFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const lanes = [26, 42, 86, 102, 34, 94, 18, 110];
  return lanes[h % lanes.length]!;
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

      const first = await makeBg(latest.current.bgs[latest.current.phase], latest.current.reduceMotion);
      if (disposed) {
        first.destroy();
        app.destroy(true, { children: true });
        return;
      }

      const world = new Container();
      app.stage.addChild(world);
      const bgLayer = new Container();
      world.addChild(bgLayer);
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
      // the room's character stands to the right, behind the pets, at the world's own pixel scale
      const npc = new Sprite();
      npc.anchor.set(0.5, 1);
      npc.eventMode = "static";
      npc.cursor = "pointer";
      npc.visible = false;
      npc.on("pointertap", () => latest.current.onNpcTap());
      world.addChild(npc);
      let shownNpc: string | null = null;
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
      // visitors' name tags and speech live in screen space so text stays crisp
      const ui = new Container();
      app.stage.addChild(ui);
      interface Visitor {
        sprite: Sprite;
        tag: Text;
        bubble: Text;
        bubbleBg: Graphics;
        x: number;
        target: number;
        lastEmote: number;
      }
      const visitors = new Map<string, Visitor>();

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
        // a poorly pet gives off a little green swirl now and then
        if (p.sick && !p.asleep && !p.reduceMotion && Math.random() < 0.012) burst("spark", 1, ["#7BD389", "#5FB46F"]);
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
            sprite.on("pointertap", () => latest.current.onOtherTap(o.id));
            world.addChildAt(sprite, world.getChildIndex(pet));
            const tag = new Text({ text: o.name, style: { fontFamily: "Baloo 2 Variable, sans-serif", fontWeight: "800", fontSize: 12, fill: "#2B2140", stroke: { color: "#FFF7E8", width: 4 } } });
            tag.anchor.set(0.5, 1);
            const bubble = new Text({ text: "", style: { fontFamily: "Baloo 2 Variable, sans-serif", fontWeight: "700", fontSize: 13, fill: "#2B2140", wordWrap: true, wordWrapWidth: 150, align: "center" } });
            bubble.anchor.set(0.5, 1);
            const bubbleBg = new Graphics();
            ui.addChild(tag, bubbleBg, bubble);
            const home = spotFor(o.id);
            v = { sprite, tag, bubble, bubbleBg, x: home, target: home, lastEmote: 0 };
            visitors.set(o.id, v);
          }
          if (!p.reduceMotion && Math.random() < 0.004) v.target = Math.max(14, Math.min(114, spotFor(o.id) + (Math.random() * 24 - 12)));
          if (Math.abs(v.target - v.x) > 0.5) v.x += Math.sign(v.target - v.x) * 0.15;
          const stageName = o.stage === "elder" ? "adult" : o.stage;
          const expr = o.mood === 3 ? "sparkly" : o.mood === 2 ? "happy" : o.mood === 0 ? "sulk" : "neutral";
          v.sprite.texture = petTexture((["gentle", "bold", "curious"].includes(o.line) ? o.line : "gentle") as SceneProps["line"], {
            stage: (["baby", "child", "teen", "adult"].includes(stageName) ? stageName : "baby") as PetStage,
            expression: (o.emote && now - o.emote.at < 2000 ? (o.emote.kind === "heart" ? "love" : "happy") : expr) as Expression,
            breath: p.reduceMotion ? 0 : Math.sin(now / 640 + v.x) > 0.35 ? 1 : 0,
            squash: 0,
            lit: false,
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
          v.tag.position.set(cx, top + scale * 10);
          const talking = o.say && now - o.say.at < 5000;
          v.bubble.text = talking ? o.say!.text : "";
          v.bubble.position.set(cx, top + scale * 10 - 18);
          v.bubbleBg.clear();
          if (talking) {
            const b = v.bubble.getLocalBounds();
            const w = b.width + 16;
            const h = b.height + 10;
            const x0 = cx - w / 2;
            const y0 = top + scale * 10 - 18 - b.height - 5;
            v.bubbleBg.roundRect(x0, y0, w, h, 10).fill({ color: 0xfffdf8 }).stroke({ color: 0x2b2140, width: 2 });
            v.bubbleBg.moveTo(cx - 5, y0 + h).lineTo(cx, y0 + h + 6).lineTo(cx + 5, y0 + h).fill({ color: 0xfffdf8 });
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
