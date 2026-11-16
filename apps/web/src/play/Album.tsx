/**
 * The visitor album (PRD M9): every travelling pet who came by while you were
 * away, with how often and when first; those not met yet are silhouettes.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { CORAL, LILAC, MINT, NIGHT, PEACH, SKY, SUNNY, type Palette, boundingBox, drawPet, wearOverlay } from "@lingxi/art";
import { type Album, VISITORS, type Visitor, addToAlbum } from "@lingxi/game";
import { useLang } from "../i18n";
import { Sprite } from "./Sprite";
import { noteTally } from "../game/tally";

const KEY = "lingxi.album.v1";
const PALETTES: Record<Visitor["look"]["palette"], Palette> = { mint: MINT, lilac: LILAC, peach: PEACH, night: NIGHT, coral: CORAL, sunny: SUNNY, sky: SKY };
const SHADOW: Palette = Object.fromEntries(Object.keys(CORAL).map((k) => [k, k === "s" ? "#2B21401A" : "#2B214059"])) as Palette;

interface AlbumStore {
  album: Album;
  /** absences already counted (petKey:to), so a reload never counts twice */
  counted: string[];
  add: (key: string, visits: Parameters<typeof addToAlbum>[1]) => void;
}

function load(): Pick<AlbumStore, "album" | "counted"> {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AlbumStore>) : {};
    return { album: v.album ?? {}, counted: v.counted ?? [] };
  } catch {
    return { album: {}, counted: [] };
  }
}

export const useAlbum = create<AlbumStore>((set, get) => ({
  ...load(),
  add: (key, visits) => {
    if (get().counted.includes(key) || !visits.length) return;
    const next = { album: addToAlbum(get().album, visits), counted: [...get().counted, key].slice(-200) };
    noteTally("EVENT", "visitor-met", visits.length);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private mode: lasts for this visit
    }
    set(next);
  },
}));

export function VisitorArt({ v, scale, hidden = false }: { v: Visitor; scale: number; hidden?: boolean }) {
  const { canvas, overlay, crop } = useMemo(() => {
    const c = drawPet(v.look.line, v.look.stage, { expression: "happy", ...(v.look.form ? { form: v.look.form } : {}) });
    const o = !hidden && v.look.outfit ? wearOverlay(c, v.look.line, v.look.stage, v.look.outfit, 0, v.look.form) : [];
    const b = boundingBox(c);
    const xs = [b.x, b.x + b.w - 1, ...o.map((p) => p[0])];
    const ys = [b.y, b.y + b.h - 1, ...o.map((p) => p[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return { canvas: c, overlay: o, crop: { x: x0, y: y0, w: Math.min(c.w, Math.max(...xs) + 2) - x0, h: Math.min(c.h, Math.max(...ys) + 2) - y0 } };
  }, [v, hidden]);
  return <Sprite canvas={canvas} palette={hidden ? SHADOW : PALETTES[v.look.palette]} scale={scale} overlay={overlay} crop={crop} label={hidden ? undefined : v.name.en} />;
}

export function AlbumPanel() {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const album = useAlbum((s) => s.album);
  const met = VISITORS.filter((v) => album[v.id]).length;
  return (
    <div className="chainpanel album">
      <p className="label">{L(`Visitor album · ${met} of ${VISITORS.length}`, `访客相册 · ${met} / ${VISITORS.length}`)}</p>
      <p className="small">{L("Travelling pets drop by while you're away. Each one met is kept here.", "你不在的时候，会有旅行中的宠物来串门。见过的都会留在这里。")}</p>
      <ul className="album-grid">
        {VISITORS.map((v) => {
          const e = album[v.id];
          return (
            <li key={v.id} className={`album-card${e ? "" : " is-unknown"} rarity-${v.rarity}`}>
              <div className="album-art">
                <VisitorArt v={v} scale={2} hidden={!e} />
              </div>
              <b>{e ? v.name[lang] : "???"}</b>
              <span className="small">
                {e
                  ? L(`${e.count} ${e.count === 1 ? "visit" : "visits"} · first ${new Date(e.first).toLocaleDateString("en", { month: "short", day: "numeric" })}`, `来过 ${e.count} 次 · 第一次 ${new Date(e.first).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}`)
                  : v.rarity === "rare"
                    ? L("rare", "稀有")
                    : v.rarity === "uncommon"
                      ? L("uncommon", "少见")
                      : L("not met yet", "还没见过")}
              </span>
              {e && <span className="small album-note">{v.note[lang]}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
