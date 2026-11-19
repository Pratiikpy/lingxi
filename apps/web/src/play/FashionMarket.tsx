/**
 * The fashion market (PRD S3, M4): every published piece, shown on your own pet;
 * buy a copy from its creator, wear it, resell copies, buy from other players,
 * and collect what your pieces have earned. New pieces are priced in BEM and the
 * market burns its whole fee in the same transaction; pieces sold before BEM
 * pricing stay on the first market, paid in OKB. Every sale is read back from
 * the chain.
 */

import { useEffect, useMemo, useState } from "react";
import { boundingBox, drawPet, wearOverlay } from "@lingxi/art";
import {
  type MarketVersion,
  type OutfitDesign,
  type OutfitListing,
  bemBurned,
  bemReadiness,
  buyDesign,
  buyListing,
  formatBem,
  listCopies,
  parseBem,
  proceedsOwed,
  wearKey,
  withdrawProceeds,
  refusesTokens,
} from "@lingxi/chain";
import { type Pet, stageOf } from "@lingxi/game";
import { formatEther, parseEther } from "viem";
import { useLang, useT } from "../i18n";
import { connectWallet, deployment, publicClient } from "../game/chain";
import { marketAvailable, marketOf, safeDecode, useDesigns } from "../game/designs";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import { now } from "../game/gameClock";
import { errorText } from "../game/errorText";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** A price in its market's own currency: OKB on the first market, BEM on the second. */
const priceText = (v: MarketVersion, units: bigint) => (v === 2 ? `${formatBem(units)} BEM` : `${formatEther(units)} OKB`);
const parsePrice = (v: MarketVersion, text: string): bigint | null => {
  if (v === 2) return parseBem(text);
  try {
    return /^\d+(\.\d{1,18})?$/.test(text.trim()) ? parseEther(text.trim()) : null;
  } catch {
    return null;
  }
};

export function OnPet({ pet, id }: { pet: Pet; id: string }) {
  const pieces = useDesigns((s) => s.pieces);
  const slot = useDesigns((s) => {
    const m = s.market.find((x) => wearKey(x.market, x.id) === id);
    return m ? safeDecode(m.pixels)?.slot : undefined;
  });
  const stage = stageOf(pet, now());
  const st = (stage === "elder" ? "adult" : stage) as "baby" | "child" | "teen" | "adult";
  const art = useMemo(() => {
    const canvas = drawPet(pet.line, st, { expression: "happy", ...(pet.form ? { form: pet.form } : {}) });
    const overlay = slot ? wearOverlay(canvas, pet.line, st, { [slot]: id }, 0, pet.form, pieces) : [];
    const b = boundingBox(canvas);
    const xs = [b.x, b.x + b.w - 1, ...overlay.map((o) => o[0])];
    const ys = [b.y, b.y + b.h - 1, ...overlay.map((o) => o[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return { canvas, overlay, crop: { x: x0, y: y0, w: Math.min(canvas.w, Math.max(...xs) + 2) - x0, h: Math.min(canvas.h, Math.max(...ys) + 2) - y0 } };
  }, [id, slot, pieces, pet.line, st, pet.form]);
  return <Sprite canvas={art.canvas} palette={PALETTE_OF[pet.line]} scale={3} overlay={art.overlay} crop={art.crop} />;
}

export function FashionMarketPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const t = useT();
  const { market, listings, held, wallet, loading, error, refresh } = useDesigns();
  const wear = useWorld((s) => s.wear);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [owed, setOwed] = useState<{ v1: bigint; v2: bigint } | null>(null);
  const [burned, setBurned] = useState<bigint | null>(null);
  const [resell, setResell] = useState<{ key: string; qty: string; price: string } | null>(null);
  const bemMarket = marketOf(2);

  useEffect(() => {
    if (marketAvailable()) void refresh();
  }, [refresh]);
  // read again whenever the market changes (a sale, a listing) or another wallet connects
  useEffect(() => {
    const bem = marketOf(2);
    if (bem) void bemBurned(publicClient, bem).then(setBurned, () => setBurned(null));
    if (!wallet) return;
    const who = wallet as `0x${string}`;
    const one = (v: 1 | 2) => {
      const m = marketOf(v);
      return m ? proceedsOwed(publicClient, m, who) : Promise.resolve(0n);
    };
    void Promise.all([one(1), one(2)]).then(([v1, v2]) => setOwed({ v1, v2 }), () => setOwed(null));
  }, [wallet, market, listings]);

  if (!marketAvailable()) return null;

  const run = async (key: string, fn: (w: Awaited<ReturnType<typeof connectWallet>>) => Promise<string>) => {
    setBusy(key);
    setNote("");
    setStep("");
    try {
      const w = await connectWallet();
      const msg = await fn(w);
      await refresh(w.account!.address);
      setNote(msg);
      play("success");
    } catch (e) {
      play("error");
      const m = errorText(e);
      setNote(
        m === "noWallet"
          ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。")
          : m === "not enough BEM"
            ? L("This wallet doesn't hold enough BEM on X Layer for that.", "这个钱包在 X Layer 上的 BEM 不够。")
            : refusesTokens(e)
              ? t("chain.cannotReceive")
              : L(`That didn't go through: ${m.split("\n")[0]}`, `没有成功：${m.split("\n")[0]}`),
      );
    }
    setBusy(null);
    setStep("");
  };

  /** Before a BEM payment: say whether the wallet will be asked to approve first. */
  const announce = async (v: MarketVersion, who: `0x${string}`, total: bigint) => {
    if (v !== 2 || !bemMarket) return;
    const r = await bemReadiness(publicClient, bemMarket, who, total);
    if (!r.enough) throw new Error("not enough BEM");
    setStep(r.needsApproval ? L("Two steps in your wallet: first allow the market to take exactly this much BEM, then buy.", "钱包里会有两步：先允许市场取用正好这么多 BEM，再购买。") : L("Confirm the purchase in your wallet.", "请在钱包里确认购买。"));
  };

  const buy = (m: OutfitDesign) =>
    run(`buy:${wearKey(m.market, m.id)}`, async (w) => {
      await announce(m.market, w.account!.address, m.price);
      await buyDesign(publicClient, w, marketOf(m.market)!, m.id, 1, m.price);
      return L(`Bought a copy of “${m.name}” for ${priceText(m.market, m.price)}.`, `用 ${priceText(m.market, m.price)} 买了一份「${m.name}」。`);
    });

  const buyResale = (l: OutfitListing) =>
    run(`resale:${l.market}:${l.id}`, async (w) => {
      await announce(l.market, w.account!.address, l.priceEach);
      await buyListing(publicClient, w, marketOf(l.market)!, l.id, 1, l.priceEach);
      return L(`Bought one “${nameOf(l)}” from ${short(l.seller)}.`, `从 ${short(l.seller)} 那里买了一份「${nameOf(l)}」。`);
    });

  const isPin = (m: OutfitDesign) => m.market === 2 && deployment?.holderOutfit !== undefined && m.id === BigInt(deployment.holderOutfit);
  const nameOf = (l: OutfitListing) => market.find((m) => m.market === l.market && m.id === l.design)?.name ?? `#${l.design}`;
  const pieces = market.filter((m) => !m.item);
  const forSale = (m: OutfitDesign) => !m.closed && m.price > 0n && m.minted < m.maxSupply;
  const daysLeft = (t: number) => Math.max(1, Math.ceil((t - now() / 1000) / 86_400));

  return (
    <div className="chainpanel fashion">
      <p className="label">{L("Fashion market", "时装市场")}</p>
      <p className="small">
        {L(
          "Pieces drawn by players, shown on your own pet. A copy is yours to wear for good; you can resell it too. New pieces are priced in BEM; the creator earns on every sale, and the market's 3% fee is burned. Pieces listed before BEM pricing still sell on the first market in OKB, where the 3% fee goes to the project.",
          "玩家画的衣服，直接穿在你的宠物身上看。买到的一份永远归你穿，也可以转卖。新作品用 BEM 定价；每卖出一份作者都有收入，市场 3% 的手续费会被销毁。BEM 定价之前上架的作品仍在第一个市场用 OKB 交易，那里 3% 的手续费归项目所有。",
        )}
      </p>
      {burned !== null && burned > 0n && (
        <p className="small fashion-burned">{L(`BEM burned by this market so far: ${formatBem(burned)}`, `这个市场至今已销毁 BEM：${formatBem(burned)}`)}</p>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={loading} onClick={() => (play("tap"), void (wallet ? refresh() : run("connect", async () => L("Wallet connected.", "钱包已连接。"))))}>
          {loading ? L("Reading the market…", "正在读取市场……") : wallet ? L("Refresh", "刷新") : L("Connect a wallet", "连接钱包")}
        </button>
        {wallet && <span className="small">{L(`Wallet ${short(wallet)}`, `钱包 ${short(wallet)}`)}</span>}
      </div>
      {error && <p className="small sp-warn">{L("The market couldn't be read just now.", "暂时读不到市场。")}</p>}
      {!loading && !pieces.length && !error && <p className="small">{L("Nothing published yet. Draw a piece in the studio and be the first.", "还没有人发布作品。去工作室画一件，做第一个吧。")}</p>}
      <ul className="fashion-grid">
        {pieces.map((m) => {
          const key = wearKey(m.market, m.id);
          const mine = held[key] ?? 0;
          const open = forSale(m);
          return (
            <li key={key} className="fashion-card">
              <OnPet pet={pet} id={key} />
              <b>{m.name}</b>
              <span className="small">{L(`by ${short(m.creator)} · ${m.minted}/${m.maxSupply}`, `作者 ${short(m.creator)} · ${m.minted}/${m.maxSupply}`)}</span>
              <span className="small">
                {open
                  ? priceText(m.market, m.price)
                  : isPin(m)
                    ? L("a free gift for TapeOut holders: claim it under Holder cosmetics", "送给 TapeOut 持有人的免费礼物：在「持有人外观」里领取")
                    : L("not for sale by its creator", "作者暂不出售")}
              </span>
              {mine > 0 && <span className="small fashion-have">{L(`You have ${mine}`, `你有 ${mine} 份`)}</span>}
              <div className="fashion-actions">
                {open && (
                  <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void buy(m)}>
                    {busy === `buy:${key}` ? L("Buying…", "购买中……") : L("Buy a copy", "买一份")}
                  </button>
                )}
                {mine > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const d = safeDecode(m.pixels);
                        if (d) {
                          wear(String(pet.bornAt), d.slot, key);
                          play("success");
                        }
                      }}
                    >
                      {L("Wear", "穿上")}
                    </button>
                    <button type="button" className="btn" onClick={() => setResell({ key, qty: "1", price: m.market === 2 ? formatBem(m.price || 10_000_000n) : formatEther(m.price || parseEther("0.001")) })}>
                      {L("Resell", "转卖")}
                    </button>
                  </>
                )}
              </div>
              {resell?.key === key && (
                <form
                  className="fashion-resell"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const qty = Math.max(1, Math.min(mine, Math.floor(Number(resell.qty) || 1)));
                    const each = parsePrice(m.market, resell.price);
                    if (!each || each <= 0n) {
                      setNote(L("Enter a price above zero.", "请填一个大于零的价格。"));
                      return;
                    }
                    if (m.market === 2 && each < 10_000n) {
                      setNote(L("The lowest price on the market is 0.0001 BEM.", "市场上的最低价格是 0.0001 BEM。"));
                      return;
                    }
                    void run(`list:${key}`, async (w) => {
                      await listCopies(publicClient, w, marketOf(m.market)!, m.id, qty, each, { days: 30 });
                      setResell(null);
                      return m.market === 2
                        ? L(`Listed ${qty} for ${priceText(2, each)} each, for 30 days.`, `已挂出 ${qty} 份，每份 ${priceText(2, each)}，挂 30 天。`)
                        : L(`Listed ${qty} for ${priceText(1, each)} each.`, `已挂出 ${qty} 份，每份 ${priceText(1, each)}。`);
                    });
                  }}
                >
                  <input inputMode="numeric" value={resell.qty} onChange={(e) => setResell({ ...resell, qty: e.target.value.replace(/\D/g, "") })} aria-label={L("How many", "几份")} />
                  <input
                    inputMode="decimal"
                    value={resell.price}
                    onChange={(e) => setResell({ ...resell, price: e.target.value.replace(/[^0-9.]/g, "") })}
                    aria-label={m.market === 2 ? L("Price each (BEM)", "每份价格（BEM）") : L("Price each (OKB)", "每份价格（OKB）")}
                  />
                  <button type="submit" className="btn primary" disabled={busy !== null}>
                    {L("List", "挂出")}
                  </button>
                  {m.market === 2 && (
                    <span className="small fashion-resell-note">
                      {L("Listed for 30 days. When one of your listings of this piece sells, your other listings of it close, so list again after a sale.", "挂 30 天。这件衣服的某个挂单卖出后，你对它的其他挂单会关闭，卖出后请重新挂。")}
                    </span>
                  )}
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {listings.length > 0 && (
        <>
          <p className="label">{L("Resales", "转卖")}</p>
          <ul className="fashion-listings">
            {listings.map((l) => {
              const reserved = l.buyer !== null && l.buyer.toLowerCase() !== wallet?.toLowerCase();
              return (
                <li key={`${l.market}:${l.id}`}>
                  <span>
                    <b>{nameOf(l)}</b>
                    <span className="small">
                      {L(` · ${l.quantity} from ${short(l.seller)} · ${priceText(l.market, l.priceEach)} each`, ` · ${short(l.seller)} 的 ${l.quantity} 份 · 每份 ${priceText(l.market, l.priceEach)}`)}
                      {l.expiresAt !== null && L(` · ${daysLeft(l.expiresAt)} days left`, ` · 还剩 ${daysLeft(l.expiresAt)} 天`)}
                      {l.buyer !== null && L(` · for ${short(l.buyer)} only`, ` · 只卖给 ${short(l.buyer)}`)}
                    </span>
                  </span>
                  {wallet?.toLowerCase() !== l.seller.toLowerCase() && !reserved && (
                    <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void buyResale(l)}>
                      {L("Buy one", "买一份")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {wallet && owed !== null && (owed.v1 > 0n || owed.v2 > 0n) && (
        <div className="row fashion-owed">
          {owed.v2 > 0n && (
            <span>
              {L(`Waiting for you: ${priceText(2, owed.v2)} from your sales.`, `市场里有你的卖出收入：${priceText(2, owed.v2)}。`)}
              <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void run("withdraw2", async (w) => (await withdrawProceeds(publicClient, w, marketOf(2)!), L(`Collected ${priceText(2, owed.v2)}.`, `已领取 ${priceText(2, owed.v2)}。`)))}>
                {L("Collect", "领取")}
              </button>
            </span>
          )}
          {owed.v1 > 0n && (
            <span>
              {L(`Waiting for you: ${priceText(1, owed.v1)} from your sales.`, `市场里有你的卖出收入：${priceText(1, owed.v1)}。`)}
              <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void run("withdraw1", async (w) => (await withdrawProceeds(publicClient, w, marketOf(1)!), L(`Collected ${priceText(1, owed.v1)}.`, `已领取 ${priceText(1, owed.v1)}。`)))}>
                {L("Collect", "领取")}
              </button>
            </span>
          )}
        </div>
      )}
      {step && (
        <p className="small" role="status">
          {step}
        </p>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
