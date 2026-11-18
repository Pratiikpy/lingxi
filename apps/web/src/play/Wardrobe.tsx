/**
 * The wardrobe (PRD S4, M3): what the pet wears, slot by slot, with a live
 * preview; a full set of one theme earns a title. Cosmetic only, never stats.
 */

import { useMemo, useState } from "react";
import { SETS, SLOTS, boundingBox, drawPet, type Outfit, wearOverlay, wearableOf } from "@lingxi/art";
import { useDesigns } from "../game/designs";
import { type Pet, stageOf } from "@lingxi/game";
import { lookLimit, outfitOf, ownedPieces, savedLooks, setOf } from "@lingxi/world";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import { now } from "../game/gameClock";

const SLOT_NAME: Record<(typeof SLOTS)[number], { en: string; zh: string }> = { head: { en: "Head", zh: "头上" }, face: { en: "Face", zh: "脸上" }, held: { en: "Held", zh: "手里" } };

/** The pet as drawn with its outfit, for portraits. */
export function useWornArt(pet: Pet, expression: "happy" | "neutral" | "sparkly" = "happy") {
  const world = useWorld((s) => s.world);
  const outfit = outfitOf(world, String(pet.bornAt));
  const pieces = useDesigns((s) => s.pieces);
  const stage = stageOf(pet, now());
  const drawn = (stage === "elder" ? "adult" : stage) as "baby" | "child" | "teen" | "adult";
  return useMemo(() => {
    const canvas = drawPet(pet.line, drawn, { expression, ...(pet.form ? { form: pet.form } : {}) });
    return { canvas, overlay: wearOverlay(canvas, pet.line, drawn, outfit as Outfit, 0, pet.form, pieces), outfit };
  }, [pet.line, drawn, pet.form, expression, outfit, pieces]);
}

export function WardrobePanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { world, wear } = useWorld();
  const local = useDesigns((s) => s.local);
  const held = useDesigns((s) => s.held);
  const atHome = useDesigns((s) => s.atHome);
  // Lingxi's pieces, limited pieces held on X Layer, pieces drawn here, then market copies this wallet holds or keeps in the pet's home
  const owned = [...ownedPieces(world), ...(world.wardrobe?.chainHeld ?? []), ...local.map((l) => l.id), ...new Set([...Object.keys(held), ...Object.keys(atHome)])];
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
      <SavedLooks petKey={key} outfit={outfit as Outfit} lang={lang} />
    </div>
  );
}

/** Saved looks (plan 4.9): whole outfits kept under a name and put on in one tap. */
function SavedLooks({ petKey, outfit, lang }: { petKey: string; outfit: Outfit; lang: "en" | "zh" }) {
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const { saveLook, wearLook, renameLook, deleteLook } = useWorld.getState();
  const looks = savedLooks(world);
  const limit = lookLimit(world);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const pieceName = (id: string) => wearableOf(id)?.name[lang] ?? id;
  const dressed = SLOTS.some((s) => outfit[s]);
  const full = looks.length >= limit;

  const save = () => {
    const r = saveLook(name.trim() || L(`Look ${looks.length + 1}`, `搭配 ${looks.length + 1}`), petKey);
    if (r.ok) {
      setName("");
      setNote(L("Saved.", "存好了。"));
    } else
      setNote(
        r.reason === "same"
          ? L("That outfit is already saved.", "这套已经存过了。")
          : r.reason === "full"
            ? L(`All ${limit} looks are used. Delete one, or add more in Extras.`, `${limit} 套都存满了。删掉一套，或者在「小额外」里加几套。`)
            : r.reason === "empty"
              ? L("Put something on first.", "先穿上点什么吧。")
              : L("That name can't be used.", "这个名字不能用。"),
      );
  };
  const put = (id: string) => {
    const r = wearLook(petKey, id);
    if (!r.ok) return setNote(r.reason === "locked" ? L("This look is over your limit. Delete one, or add more in Extras.", "这套超出了上限。删掉一套，或者在「小额外」里加几套。") : L("That look is gone.", "这套已经没有了。"));
    setNote(r.missing.length ? L(`On, without ${r.missing.map(pieceName).join(", ")}: you no longer have ${r.missing.length > 1 ? "them" : "it"}.`, `穿上了，少了${r.missing.map(pieceName).join("、")}：你已经没有了。`) : "");
  };

  return (
    <div className="wd-looks">
      <p className="wd-slot-name">{L(`Saved looks · ${looks.length} of ${limit}`, `存的搭配 · ${looks.length}/${limit}`)}</p>
      {looks.length > 0 && (
        <ul className="wd-look-list">
          {looks.map((l, i) => {
            const locked = i >= limit;
            return (
              <li key={l.id} className={`wd-look${locked ? " is-locked" : ""}`}>
                {editing?.id === l.id ? (
                  <form
                    className="wd-look-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameLook(l.id, editing.name)) setEditing(null);
                    }}
                  >
                    <input value={editing.name} maxLength={16} onChange={(e) => setEditing({ id: l.id, name: e.target.value })} aria-label={L("Look name", "搭配名字")} autoFocus />
                    <button type="submit" className="btn primary">
                      {L("Done", "好")}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="wd-look-text">
                      <b>{l.name}</b>
                      <span className="small">{SLOTS.map((s) => l.outfit[s]).filter(Boolean).map((id) => pieceName(id!)).join(" · ")}</span>
                      {locked && <span className="small">{L("Over your limit: kept, not wearable", "超出上限：留着，暂不能穿")}</span>}
                    </div>
                    <div className="wd-look-actions">
                      <button type="button" className="btn primary" disabled={locked} onClick={() => put(l.id)}>
                        {L("Wear", "穿上")}
                      </button>
                      <button type="button" className="btn" onClick={() => setEditing({ id: l.id, name: l.name })} aria-label={L(`Rename ${l.name}`, `给${l.name}改名`)}>
                        {L("Rename", "改名")}
                      </button>
                      <button type="button" className="btn" onClick={() => deleteLook(l.id)} aria-label={L(`Delete ${l.name}`, `删除${l.name}`)}>
                        {L("Delete", "删除")}
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dressed && !full && (
        <form
          className="wd-look-edit"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input value={name} maxLength={16} placeholder={L(`Look ${looks.length + 1}`, `搭配 ${looks.length + 1}`)} onChange={(e) => setName(e.target.value)} aria-label={L("Name this look", "给这套起个名字")} />
          <button type="submit" className="btn">
            {L("Save this outfit", "存下这套")}
          </button>
        </form>
      )}
      {dressed && full && <p className="small">{L(`All ${limit} looks are used. Delete one, or add more in Extras.`, `${limit} 套都存满了。删掉一套，或者在「小额外」里加几套。`)}</p>}
      {!dressed && looks.length === 0 && <p className="small">{L("Dress your pet, then save the outfit here to put it on again in one tap.", "给宠物穿好以后，可以在这里存下这套，下次一点就能穿上。")}</p>}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
