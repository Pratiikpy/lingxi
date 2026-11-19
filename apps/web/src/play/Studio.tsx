/**
 * The design studio (PRD S3): draw an outfit piece on a small pixel grid, see it
 * on the pet as you draw, keep it and wear it, and publish it to the fashion
 * market, where others can buy copies and the creator earns on every sale.
 */

import { useMemo, useRef, useState } from "react";
import { type Design, DesignError, DESIGN_FACE_MAX_W, DESIGN_MAX_H, DESIGN_MAX_W, SLOTS, type Slot, boundingBox, designWearable, drawPet, trimDesign, wearOverlay, encodeDesign } from "@lingxi/art";
import { currentMarket, parseBem, publishDesign } from "@lingxi/chain";
import { now } from "../game/gameClock";

/** The BEM market's smallest price per copy (its MIN_PRICE: 0.0001 BEM). */
const MIN_BEM_PRICE = 10_000n;
import { type Pet, stageOf } from "@lingxi/game";
import { parseEther } from "viem";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient } from "../game/chain";
import { marketAvailable, useDesigns } from "../game/designs";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import { errorText, firstLine } from "../game/errorText";

type Lang = "en" | "zh";
const SLOT_NAME: Record<Slot, { en: string; zh: string }> = { head: { en: "Head", zh: "头上" }, face: { en: "Face", zh: "脸上" }, held: { en: "Held", zh: "手里" } };
const SWATCHES = ["#2b2140", "#ffffff", "#e8604a", "#ff8fae", "#ffc83d", "#f2cf73", "#7fcb8e", "#4e9e6a", "#7fb7f0", "#3f6fb8", "#b07fe0", "#7a5236"];
const empty = (w: number, h: number) => Array.from({ length: h }, () => new Array(w).fill(0));

export function StudioPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const save = useDesigns((s) => s.save);
  const markPublished = useDesigns((s) => s.markPublished);
  const refresh = useDesigns((s) => s.refresh);
  const wear = useWorld((s) => s.wear);
  const [slot, setSlot] = useState<Slot>("head");
  const width = slot === "face" ? DESIGN_FACE_MAX_W : DESIGN_MAX_W;
  const [cells, setCells] = useState(() => empty(DESIGN_MAX_W, DESIGN_MAX_H));
  const [colours, setColours] = useState(["#2b2140", "#e8604a", "#ffc83d"]);
  const [ink, setInk] = useState(1);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("0.1");
  const [supply, setSupply] = useState("100");
  const [royalty, setRoyalty] = useState("5");
  const [busy, setBusy] = useState(false);
  const bemMarket = !!deployment && currentMarket(deployment)?.v === 2;
  const painting = useRef(false);

  const design = useMemo<Design>(() => ({ slot, cells: cells.slice(0, DESIGN_MAX_H).map((r) => r.slice(0, width)), colours }), [slot, cells, width, colours]);
  const grid = design.cells;
  const drawn = grid.some((r) => r.some((v) => v > 0));

  // the pet wearing the piece as it is drawn
  const stage = stageOf(pet, now());
  const st = (stage === "elder" ? "adult" : stage) as "baby" | "child" | "teen" | "adult";
  const preview = useMemo(() => {
    const canvas = drawPet(pet.line, st, { expression: "happy", ...(pet.form ? { form: pet.form } : {}) });
    let overlay: ReturnType<typeof wearOverlay> = [];
    if (drawn) {
      try {
        // the piece being drawn is lent to this picture alone; nothing is registered until it is saved
        const pieces = new Map([["u:preview", designWearable("u:preview", trimDesign(design), { en: "", zh: "" })]]);
        overlay = wearOverlay(canvas, pet.line, st, { [design.slot]: "u:preview" }, 0, pet.form, pieces);
      } catch {
        overlay = [];
      }
    }
    const b = boundingBox(canvas);
    const xs = [b.x, b.x + b.w - 1, ...overlay.map((o) => o[0])];
    const ys = [b.y, b.y + b.h - 1, ...overlay.map((o) => o[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return { canvas, overlay, crop: { x: x0, y: y0, w: Math.min(canvas.w, Math.max(...xs) + 2) - x0, h: Math.min(canvas.h, Math.max(...ys) + 2) - y0 } };
  }, [design, drawn, pet.line, st, pet.form]);

  const paint = (x: number, y: number) =>
    setCells((c) => {
      if (c[y]![x] === ink) return c;
      const next = c.map((r) => r.slice());
      next[y]![x] = ink;
      return next;
    });

  const keep = (): string | null => {
    setNote("");
    if (!name.trim()) {
      setNote(L("Give it a name first.", "先给它起个名字。"));
      return null;
    }
    try {
      encodeDesign(design);
    } catch (e) {
      setNote(e instanceof DesignError ? L(`It can't be kept yet: ${e.message}.`, `还不能保存：${e.message}。`) : String(e));
      return null;
    }
    // only the colours actually used are kept
    const used = [1, 2, 3].filter((k) => grid.some((r) => r.includes(k)));
    const remap = (v: number) => (v === 0 ? 0 : used.indexOf(v) + 1);
    const id = save(name.trim(), { slot, cells: grid.map((r) => r.map(remap)), colours: used.map((k) => colours[k - 1]!) });
    wear(String(pet.bornAt), slot, id);
    play("success");
    return id;
  };

  const publish = async () => {
    const id = keep();
    const market = deployment ? currentMarket(deployment) : null;
    if (!id || !market) return;
    // new pieces go to the newest market: BEM when it is deployed, OKB before that
    const priceUnits = market.v === 2 ? parseBem(price || "0") : /^\d+(\.\d{1,18})?$/.test(price) ? parseEther(price) : null;
    if (priceUnits === null || priceUnits <= 0n) {
      setNote(L("Enter a price above zero.", "请填一个大于零的价格。"));
      return;
    }
    if (market.v === 2 && priceUnits < MIN_BEM_PRICE) {
      setNote(L("The lowest price on the market is 0.0001 BEM.", "市场上的最低价格是 0.0001 BEM。"));
      return;
    }
    setBusy(true);
    try {
      const max = Math.max(1, Math.min(100_000, Math.floor(Number(supply) || 1)));
      const bps = Math.max(0, Math.min(1000, Math.round((Number(royalty) || 0) * 100)));
      const w = await connectWallet();
      const local = useDesigns.getState().local.find((l) => l.id === id)!;
      const pixels = Uint8Array.from((local.hex.match(/../g) ?? []).map((x) => parseInt(x, 16)));
      const r = await publishDesign(publicClient, w, market, { pixels, name: local.name, price: priceUnits, maxSupply: max, royaltyBps: bps });
      markPublished(id, r.id.toString());
      await refresh(w.account!.address);
      setNote(L(`Published as market piece #${r.id}. Anyone can now buy a copy.`, `已发布为市场作品 #${r.id}。现在谁都能买一份。`));
      play("success");
    } catch (e) {
      setNote(errorText(e) === "noWallet" ? L("No wallet found in this browser.", "这个浏览器里没有钱包。") : L(`Publishing didn't go through: ${firstLine(e)}`, `发布没有成功：${firstLine(e)}`));
    }
    setBusy(false);
  };

  return (
    <div className="chainpanel studio">
      <p className="label">{L("Design studio", "设计工作室")}</p>
      <p className="small">{L("Draw a piece, see it on your pet, keep it and wear it. Publish it to the market and others can buy copies; you earn on every sale and resale.", "画一件衣服，马上看到宠物穿上的样子，保存后就能穿。发布到市场后别人可以买，每卖出一份、每转卖一次你都有收入。")}</p>
      <div className="studio-slots" role="radiogroup" aria-label={L("Slot", "位置")}>
        {SLOTS.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={slot === s} className={`wd-chip${slot === s ? " is-on" : ""}`} onClick={() => (play("tap"), setSlot(s))}>
            {SLOT_NAME[s][lang]}
          </button>
        ))}
      </div>
      <div className="studio-main">
        <div className="studio-grid" style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }} onPointerUp={() => (painting.current = false)} onPointerLeave={() => (painting.current = false)}>
          {grid.map((row, y) =>
            row.map((v, x) => (
              <button
                key={`${x}:${y}`}
                type="button"
                className="studio-cell"
                aria-label={`${x + 1},${y + 1}`}
                style={{ background: v ? colours[v - 1] : undefined }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  painting.current = true;
                  paint(x, y);
                }}
                onPointerEnter={() => painting.current && paint(x, y)}
              />
            )),
          )}
        </div>
        <div className="studio-preview">
          <Sprite canvas={preview.canvas} palette={PALETTE_OF[pet.line]} scale={4} overlay={preview.overlay} crop={preview.crop} label={pet.name} />
        </div>
      </div>
      <div className="studio-inks" role="radiogroup" aria-label={L("Colour", "颜色")}>
        {[1, 2, 3].map((k) => (
          <label key={k} className={`studio-ink${ink === k ? " is-on" : ""}`}>
            <input type="radio" name="ink" checked={ink === k} onChange={() => setInk(k)} />
            <span style={{ background: colours[k - 1] }} />
            <input type="color" value={colours[k - 1]} aria-label={L(`Colour ${k}`, `颜色 ${k}`)} onChange={(e) => setColours((c) => c.map((x, i) => (i === k - 1 ? e.target.value : x)))} />
          </label>
        ))}
        <label className={`studio-ink erase${ink === 0 ? " is-on" : ""}`}>
          <input type="radio" name="ink" checked={ink === 0} onChange={() => setInk(0)} />
          <span>{L("Erase", "擦除")}</span>
        </label>
        <button type="button" className="btn" onClick={() => (play("tap"), setCells(empty(DESIGN_MAX_W, DESIGN_MAX_H)))}>
          {L("Clear", "清空")}
        </button>
      </div>
      <div className="studio-swatches">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="studio-swatch" style={{ background: c }} aria-label={c} onClick={() => ink > 0 && setColours((cs) => cs.map((x, i) => (i === ink - 1 ? c : x)))} />
        ))}
      </div>
      <div className="studio-row">
        <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder={L("Name it", "起个名字")} aria-label={L("Name", "名字")} />
        <button type="button" className="btn primary" disabled={!drawn} onClick={() => keep()}>
          {L("Keep and wear", "保存并穿上")}
        </button>
      </div>
      {marketAvailable() && (
        <details className="studio-publish">
          <summary>{L("Publish to the market", "发布到市场")}</summary>
          <div className="studio-terms">
            <label>
              {bemMarket ? L("Price per copy (BEM)", "每份价格（BEM）") : L("Price per copy (OKB)", "每份价格（OKB）")}
              <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label>
              {L("Copies at most", "最多几份")}
              <input inputMode="numeric" value={supply} onChange={(e) => setSupply(e.target.value.replace(/\D/g, ""))} />
            </label>
            <label>
              {L("Your cut of resales (%)", "转卖时你的分成（%）")}
              <input inputMode="decimal" value={royalty} onChange={(e) => setRoyalty(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
          </div>
          <p className="small">
            {bemMarket
              ? L("3% of every sale is burned: it goes to BEM's dead address, and nobody keeps it. Up to 10% of each resale goes to you. Your proceeds wait in the market until you collect them.", "每笔交易的 3% 会被销毁：送进 BEM 的销毁地址，谁也拿不到。每次转卖最多 10% 归你。你的收入会留在市场里，等你来领取。")
              : L("The market keeps 3% of every sale. Up to 10% of each resale goes to you. Your proceeds wait in the market until you collect them.", "市场从每笔交易中收取 3%。每次转卖最多 10% 归你。你的收入会留在市场里，等你来领取。")}
          </p>
          <button type="button" className="btn primary" disabled={!drawn || busy} onClick={() => void publish()}>
            {busy ? L("Publishing…", "发布中……") : L("Publish with my wallet", "用我的钱包发布")}
          </button>
        </details>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
