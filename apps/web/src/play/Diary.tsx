/**
 * The pet's diary (PRD S1): today's page, written from a replay of its real
 * logged thoughts, and a card image to share on X, WeChat or Telegram.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { drawPet, toRgba } from "@lingxi/art";
import { type Pet, diaryOf, diaryText, mindBrain, stageOf, ruleGrowth } from "@lingxi/game";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { useWorld } from "../game/world";
import { noteEvent } from "../game/tally";
import { HOME, ROOMS } from "@lingxi/world";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { now } from "../game/gameClock";
import { recordOf } from "../game/chain";
import { diaryFooter } from "./diaryFooter";

type Lang = "en" | "zh";
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));

export function DiaryPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [busy, setBusy] = useState(false);
  const room = useWorld((s) => s.world.room);
  const backdrop = (ROOMS[room] ?? ROOMS[HOME]!).bgs.day;
  // the log grows by a word every beat, so the pet changing and the log changing come at the same pace
  const lines = useMemo(() => diaryOf(pet, (lessons, outside, skills) => mindBrain({ line: pet.line, lessons, family: pet.family, instincts: pet.instincts, outside, growth: ruleGrowth(skills) })), [pet]);
  const date = new Date(now()).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", { month: "long", day: "numeric", weekday: "long" });

  const share = async () => {
    setBusy(true);
    try {
      const blob = await card(pet, lines.map((l) => diaryText(l, lang)), date, lang, backdrop.endsWith(".gif") ? (ROOMS[HOME]!.bgs.day) : backdrop);
      const file = new File([blob], `${pet.name}-diary.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: lang === "zh" ? `${pet.name}的日记` : `${pet.name}'s diary` });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      play("success");
    } catch {
      // the share sheet was dismissed
    } finally {
      setBusy(false);
    }
  };

  // the diary counts as read once half of it has been on screen (quests count it)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        noteEvent("diary-read");
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={box} className="chainpanel diary">
      <p className="label">{lang === "zh" ? `${pet.name}的日记 · ${date}` : `${pet.name}'s diary · ${date}`}</p>
      <ul className="diary-lines">
        {lines.map((l, i) => (
          <li key={i}>{diaryText(l, lang)}</li>
        ))}
      </ul>
      <p className="small">{lang === "zh" ? "每一句都来自它今天真实的念头，重放它的电路得出。" : "Every line comes from its real thoughts today, replayed through its circuit."}</p>
      <button type="button" className="btn" disabled={busy} onClick={share}>
        {lang === "zh" ? "分享今天这页" : "Share today's page"}
      </button>
    </div>
  );
}

/** A 1080×1350 card: the pet, the date, the day's lines. */
async function card(pet: Pet, lines: string[], date: string, lang: Lang, backdrop: string): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#FFF7E8";
  g.fillRect(0, 0, W, H);
  // the pet in the room it is in today, cropped to the frame
  const bg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("no backdrop"));
    im.src = backdrop;
  });
  g.save();
  g.beginPath();
  g.roundRect(60, 60, W - 120, 560, 48);
  g.clip();
  g.imageSmoothingEnabled = false;
  const side = W - 120;
  g.drawImage(bg, 0, bg.height * 0.18, bg.width, bg.height * (560 / side), 60, 60, side, 560);
  g.restore();
  g.beginPath();
  g.roundRect(60, 60, W - 120, 560, 48);
  g.strokeStyle = "#2B2140";
  g.lineWidth = 8;
  g.stroke();
  // the pet, pixel-crisp
  const art = drawPet(pet.line, drawn(stageOf(pet, now())), { expression: "happy", ...(pet.form ? { form: pet.form } : {}) });
  const img = new ImageData(new Uint8ClampedArray(toRgba(art, PALETTE_OF[pet.line], 1)), art.w, art.h);
  const tmp = document.createElement("canvas");
  tmp.width = art.w;
  tmp.height = art.h;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  const scale = 10;
  g.drawImage(tmp, W / 2 - (art.w * scale) / 2, 610 - art.h * scale, art.w * scale, art.h * scale);
  await document.fonts.ready;
  g.fillStyle = "#2B2140";
  g.font = `700 64px "Pixelify Sans Variable", "Baloo 2 Variable", sans-serif`;
  g.textAlign = "left";
  g.fillText(lang === "zh" ? `${pet.name}的日记` : `${pet.name}'s diary`, 80, 720);
  g.font = `600 34px "Baloo 2 Variable", "Noto Sans SC", sans-serif`;
  g.fillStyle = "#5B4E73";
  g.fillText(date, 80, 772);
  g.fillStyle = "#2B2140";
  g.font = `600 40px "Baloo 2 Variable", "Noto Sans SC", sans-serif`;
  let y = 860;
  for (const line of lines.slice(0, 7)) {
    for (const part of wrap(g, line, W - 200)) {
      g.fillText(part, 120, y);
      y += 54;
    }
    g.beginPath();
    g.arc(92, y - 54 - 14, 8, 0, Math.PI * 2);
    g.fill();
    y += 10;
  }
  g.font = `600 28px "Baloo 2 Variable", "Noto Sans SC", sans-serif`;
  g.fillStyle = "#5B4E73";
  g.fillText(diaryFooter(!!recordOf(pet), lang), 80, H - 70);
  return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const cjk = /[\u3000-\u9fff]/.test(text);
  const parts = cjk ? Array.from(text) : text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const next = cur ? (cjk ? cur + p : `${cur} ${p}`) : p;
    if (g.measureText(next).width > max && cur) {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
