/**
 * The room's short-lived particles (P7: out of RoomScene): hearts, sparks and notes that rise from the pet, crumbs that
 * fall as it eats, Zzz while it sleeps, a visitor's emote. Each fades out and is gone.
 */
import { type Container, Sprite } from "pixi.js";
import { PET_FEET } from "./floor";
import { glyphTexture } from "./textures";

export interface Particle {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  /** pull downward each frame (crumbs fall; hearts and notes float) */
  g?: number;
}

/** Something drifting through the room: fireflies, pollen, rain, snow, petals. */

export interface Particles {
  /** a few glyphs rising from over the pet standing at `x` */
  burst: (kind: "heart" | "spark" | "note", n: number, colors: string[], x: number) => void;
  /** one particle, its sprite already placed */
  add: (p: Particle) => void;
  /** one frame: each moves, fades and, when spent, is gone */
  update: () => void;
}

export function createParticles(fx: Container): Particles {
  const particles: Particle[] = [];
  const add = (p: Particle) => {
    fx.addChild(p.s);
    particles.push(p);
  };
  const burst = (kind: "heart" | "spark" | "note", n: number, colors: string[], x: number) => {
    for (let i = 0; i < n; i++) {
      const s = new Sprite(glyphTexture(kind, colors[i % colors.length]!));
      s.anchor.set(0.5);
      s.x = x + (Math.random() * 18 - 9);
      s.y = PET_FEET - 30 - Math.random() * 6;
      add({ s, vx: (Math.random() - 0.5) * 0.25, vy: -0.32 - Math.random() * 0.2, life: 1 });
    }
  };
  const update = () => {
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
  return { burst, add, update };
}
