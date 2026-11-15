/**
 * The wardrobe (PRD S4, M3): what the pet wears, slot by slot, with a live
 * preview; a full set of one theme earns a title. Cosmetic only, never stats.
 */

import { useMemo } from "react";
import { SETS, SLOTS, boundingBox, drawPet, type Outfit, wearOverlay, wearableOf } from "@lingxi/art";
import { useDesigns } from "../game/designs";
import { type Pet, stageOf } from "@lingxi/game";
import { outfitOf, ownedPieces, setOf } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";

const SLOT_NAME: Record<(typeof SLOTS)[number], { en: string; zh: string }> = { head: { en: "Head", zh: "头上" }, face: { en: "Face", zh: "脸上" }, held: { en: "Held", zh: "手里" } };

/** The pet as drawn with its outfit, for portraits. */
export function useWornArt(pet: Pet, expression: "happy" | "neutral" | "sparkly" = "happy") {
  const world = useWorld((s) => s.world);
  const outfit = outfitOf(world, String(pet.bornAt));
  const version = useDesigns((s) => s.version);
  const stage = stageOf(pet, Date.now());
  const drawn = (stage === "elder" ? "adult" : stage) as "baby" | "child" | "teen" | "adult";
  return useMemo(() => {
    const canvas = drawPet(pet.line, drawn, { expression, ...(pet.form ? { form: pet.form } : {}) });
    return { canvas, overlay: wearOverlay(canvas, pet.line, drawn, outfit as Outfit, 0, pet.form), outfit };
  }, [pet.line, drawn, pet.form, expression, outfit.head, outfit.face, outfit.held, version]);
}

export function WardrobePanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { world, wear } = useWorld();
  const local = useDesigns((s) => s.local);
  const held = useDesigns((s) => s.held);
  // Lingxi's pieces, then pieces drawn here, then market copies this wallet holds
  const owned = [...ownedPieces(world), ...local.map((l) => l.id), ...Object.keys(held).map((id) => `c:${id}`)];
  const key = String(pet.bornAt);
  const { canvas, overlay, outfit } = useWornArt(pet);
  const set = setOf(outfit);
  // frame the pet and everything it wears, with a pixel of air around
  const b = boundingBox(canvas);
  const xs = [b.x, b.x + b.w - 1, ...overlay.map((o) => o[0])];
  const ys = [b.y, b.y + b.h - 1, ...overlay.map((o) => o[1])];
  const x0 = Math.max(0, Math.min(...xs) - 1);
  const y0 = Math.max(0, Math.min(...ys) - 1);
  const crop = { x: x0, y: y0, w: Math.min(canvas.w, Math.max(...xs) + 2) - x0, h: Math.min(canvas.h, Math.max(...ys) + 2) - y0 };

  return (
    <div className="chainpanel wardrobe">
      <p className="label">{L("Wardrobe", "衣橱")}</p>
      <div className="wd-top">
        <div className="wd-preview">
          <Sprite canvas={canvas} palette={PALETTE_OF[pet.line]} scale={3} overlay={overlay} crop={crop} label={pet.name} />
        </div>
        <div className="wd-text">
          {set && SETS[set] ? (
            <p className="wd-title">
              {L(`A full ${SETS[set].name.en} set: “${SETS[set].title.en}”`, `整套${SETS[set].name.zh}：「${SETS[set].title.zh}」`)}
            </p>
          ) : (
            <p className="small">{L("Wear one piece of a theme in each slot for a title. Looks only: it never changes how it plays.", "每个位置都穿同一主题的一件，就能得到称号。只是好看，不影响任何玩法。")}</p>
          )}
          {!owned.length && <p className="small">{L("No outfits yet. Sew them at the workbench from things you find, or buy a few at the Corner Shop.", "还没有衣服。可以在工作台用找到的东西缝，或者去街角小店买几件。")}</p>}
        </div>
      </div>
      {owned.length > 0 &&
        SLOTS.map((slot) => {
          const mine = owned.filter((id) => wearableOf(id)?.slot === slot);
          if (!mine.length) return null;
          return (
            <div key={slot} className="wd-slot" role="radiogroup" aria-label={SLOT_NAME[slot][lang]}>
              <span className="wd-slot-name">{SLOT_NAME[slot][lang]}</span>
              <button type="button" role="radio" aria-checked={!outfit[slot]} className={`wd-chip${!outfit[slot] ? " is-on" : ""}`} onClick={() => wear(key, slot, null)}>
                {L("None", "不穿")}
              </button>
              {mine.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={outfit[slot] === id} className={`wd-chip${outfit[slot] === id ? " is-on" : ""}`} onClick={() => wear(key, slot, id)}>
                  {wearableOf(id)!.name[lang]}
                </button>
              ))}
            </div>
          );
        })}
    </div>
  );
}
