/**
 * What drifts through the room (P7: out of RoomScene): motes in the light by day, fireflies at night, and today's
 * weather when the room is outdoors (rain, snow, petals or leaves). None with reduced motion.
 */
import { type Container, Sprite } from "pixi.js";
import type { DayPhase } from "./dayPhase";
import { ROOM } from "./floor";
import { BITS } from "./textures";
import type { Weather } from "./weather";

interface Drift {
  s: Sprite;
  kind: "firefly" | "mote" | "drop" | "flake" | "petal";
  vx: number;
  vy: number;
  ph: number;
}

export interface Drifts {
  update: (p: { reduceMotion: boolean; phase: DayPhase; outdoors?: boolean }) => void;
}

export function createDrifts(sky: Container, weather: Weather): Drifts {
  const drifts: Drift[] = [];
  const update = (p: { reduceMotion: boolean; phase: DayPhase; outdoors?: boolean }) => {
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
            kind === "firefly"
              ? BITS.firefly()
              : kind === "mote"
                ? BITS.mote(p.phase === "evening" ? "#FFB86B" : "#FFF7D6")
                : kind === "drop"
                  ? BITS.drop()
                  : kind === "flake"
                    ? BITS.flake()
                    : BITS.petal(
                        weather === "leaves"
                          ? Math.random() < 0.5
                            ? "#E8803A"
                            : "#C9542F"
                          : Math.random() < 0.5
                            ? "#FFB3C7"
                            : "#FFD9E2",
                      );
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
            vy:
              kind === "drop"
                ? 2.4
                : kind === "flake"
                  ? 0.22 + Math.random() * 0.12
                  : kind === "petal"
                    ? 0.3
                    : -0.04 - Math.random() * 0.05,
            ph: Math.random() * 6.28,
          };
          drifts.push(d);
        }
      }
      for (let i = drifts.length - 1; i >= 0; i--) {
        const d = drifts[i]!;
        d.ph += 0.03;
        d.s.x +=
          d.vx +
          (d.kind === "flake" || d.kind === "petal"
            ? Math.sin(d.ph) * 0.18
            : d.kind === "firefly"
              ? Math.sin(d.ph * 0.7) * 0.15
              : 0);
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
  };
  return { update };
}
