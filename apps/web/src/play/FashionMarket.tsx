/**
 * The fashion market (PRD S3, M4): every published piece, shown on your own pet;
 * buy a copy from its creator, wear it, resell copies, buy from other players,
 * and collect what your pieces have earned. Payments are in OKB on X Layer and
 * every sale is read back from the chain.
 */

import { useEffect, useMemo, useState } from "react";
import { boundingBox, drawPet, wearOverlay } from "@lingxi/art";
import { buyDesign, buyListing, listCopies, proceedsOwed, withdrawProceeds, type OutfitDesign } from "@lingxi/chain";
import { type Pet, stageOf } from "@lingxi/game";
import { formatEther, parseEther } from "viem";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient } from "../game/chain";
import { marketAvailable, safeDecode, useDesigns } from "../game/designs";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const okb = (wei: bigint) => `${formatEther(wei)} OKB`;

function OnPet({ pet, id }: { pet: Pet; id: string }) {
  const version = useDesigns((s) => s.version);
  const slot = useDesigns((s) => {
    const m = s.market.find((x) => `c:${x.id}` === id);
    return m ? safeDecode(m.pixels)?.slot : undefined;
  });
  const stage = stageOf(pet, Date.now());
  const st = (stage === "elder" ? "adult" : stage) as "baby" | "child" | "teen" | "adult";
  const art = useMemo(() => {
    const canvas = drawPet(pet.line, st, { expression: "happy", ...(pet.form ? { form: pet.form } : {}) });
    const overlay = slot ? wearOverlay(canvas, pet.line, st, { [slot]: id }, 0, pet.form) : [];
    const b = boundingBox(canvas);
    const xs = [b.x, b.x + b.w - 1, ...overlay.map((o) => o[0])];
    const ys = [b.y, b.y + b.h - 1, ...overlay.map((o) => o[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return { canvas, overlay, crop: { x: x0, y: y0, w: Math.min(canvas.w, Math.max(...xs) + 2) - x0, h: Math.min(canvas.h, Math.max(...ys) + 2) - y0 } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, slot, version, pet.line, st, pet.form]);
  return <Sprite canvas={art.canvas} palette={PALETTE_OF[pet.line]} scale={3} overlay={art.overlay} crop={art.crop} />;
}

export function FashionMarketPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { market, listings, held, wallet, loading, error, refresh } = useDesigns();
  const wear = useWorld((s) => s.wear);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [owed, setOwed] = useState<bigint | null>(null);
  const [resell, setResell] = useState<{ id: string; qty: string; price: string } | null>(null);

  useEffect(() => {
    if (marketAvailable()) void refresh();
  }, [refresh]);
  useEffect(() => {
    if (wallet && deployment) void proceedsOwed(publicClient, deployment, wallet as `0x${string}`).then(setOwed).catch(() => setOwed(null));
  }, [wallet, market.length, listings.length]);

  if (!marketAvailable()) return null;

  const run = async (key: string, fn: (w: Awaited<ReturnType<typeof connectWallet>>) => Promise<string>) => {
    setBusy(key);
    setNote("");
    try {
      const w = await connectWallet();
      const msg = await fn(w);
      await refresh(w.account!.address);
      setNote(msg);
      play("success");
    } catch (e) {
      play("error");
      setNote((e as Error).message === "noWallet" ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。") : L(`That didn't go through: ${(e as Error).message.split("\n")[0]}`, `没有成功：${(e as Error).message.split("\n")[0]}`));
    }
    setBusy(null);
  };

  const buy = (m: OutfitDesign) =>
    run(`buy:${m.id}`, async (w) => {
      await buyDesign(publicClient, w, deployment!, m.id, 1, m.price);
      return L(`Bought a copy of “${m.name}” for ${okb(m.price)}.`, `用 ${okb(m.price)} 买了一份「${m.name}」。`);
    });

  const nameOf = (id: bigint) => market.find((m) => m.id === id)?.name ?? `#${id}`;
  const forSale = market.filter((m) => !m.closed && m.price > 0n && m.minted < m.maxSupply);

  return (
    <div className="chainpanel fashion">
      <p className="label">{L("Fashion market", "时装市场")}</p>
      <p className="small">{L("Pieces drawn by players, shown on your own pet. A copy is yours to wear for good; you can resell it too. The creator earns on every sale.", "玩家画的衣服，直接穿在你的宠物身上看。买到的一份永远归你穿，也可以转卖。每卖出一份，作者都有收入。")}</p>
      <div className="row">
        <button type="button" className="btn" disabled={loading} onClick={() => (play("tap"), void (wallet ? refresh() : run("connect", async () => L("Wallet connected.", "钱包已连接。"))))}>
          {loading ? L("Reading the market…", "正在读取市场……") : wallet ? L("Refresh", "刷新") : L("Connect a wallet", "连接钱包")}
        </button>
        {wallet && <span className="small">{L(`Wallet ${short(wallet)}`, `钱包 ${short(wallet)}`)}</span>}
      </div>
      {error && <p className="small sp-warn">{L("The market couldn't be read just now.", "暂时读不到市场。")}</p>}
      {!loading && !market.length && !error && <p className="small">{L("Nothing published yet. Draw a piece in the studio and be the first.", "还没有人发布作品。去工作室画一件，做第一个吧。")}</p>}
      <ul className="fashion-grid">
        {market.map((m) => {
          const mine = held[m.id.toString()] ?? 0;
          const open = forSale.includes(m);
          return (
            <li key={m.id.toString()} className="fashion-card">
              <OnPet pet={pet} id={`c:${m.id}`} />
              <b>{m.name}</b>
              <span className="small">{L(`by ${short(m.creator)} · ${m.minted}/${m.maxSupply}`, `作者 ${short(m.creator)} · ${m.minted}/${m.maxSupply}`)}</span>
              <span className="small">{open ? okb(m.price) : L("not for sale by its creator", "作者暂不出售")}</span>
              {mine > 0 && <span className="small fashion-have">{L(`You have ${mine}`, `你有 ${mine} 份`)}</span>}
              <div className="fashion-actions">
                {open && (
                  <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void buy(m)}>
                    {busy === `buy:${m.id}` ? L("Buying…", "购买中……") : L("Buy a copy", "买一份")}
                  </button>
                )}
                {mine > 0 && (
                  <>
                    <button type="button" className="btn" onClick={() => {
                      const d = safeDecode(m.pixels);
                      if (d) {
                        wear(String(pet.bornAt), d.slot, `c:${m.id}`);
                        play("success");
                      }
                    }}>
                      {L("Wear", "穿上")}
                    </button>
                    <button type="button" className="btn" onClick={() => setResell({ id: m.id.toString(), qty: "1", price: formatEther(m.price || parseEther("0.001")) })}>
                      {L("Resell", "转卖")}
                    </button>
                  </>
                )}
              </div>
              {resell?.id === m.id.toString() && (
                <form
                  className="fashion-resell"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const qty = Math.max(1, Math.min(mine, Math.floor(Number(resell.qty) || 1)));
                    void run(`list:${m.id}`, async (w) => {
                      await listCopies(publicClient, w, deployment!, m.id, qty, parseEther(resell.price || "0"));
                      setResell(null);
                      return L(`Listed ${qty} for ${resell.price} OKB each.`, `已挂出 ${qty} 份，每份 ${resell.price} OKB。`);
                    });
                  }}
                >
                  <input inputMode="numeric" value={resell.qty} onChange={(e) => setResell({ ...resell, qty: e.target.value.replace(/\D/g, "") })} aria-label={L("How many", "几份")} />
                  <input inputMode="decimal" value={resell.price} onChange={(e) => setResell({ ...resell, price: e.target.value.replace(/[^0-9.]/g, "") })} aria-label={L("Price each (OKB)", "每份价格（OKB）")} />
                  <button type="submit" className="btn primary" disabled={busy !== null}>
                    {L("List", "挂出")}
                  </button>
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
            {listings.map((l) => (
              <li key={l.id.toString()}>
                <span>
                  <b>{nameOf(l.design)}</b>
                  <span className="small">{L(` · ${l.quantity} from ${short(l.seller)} · ${okb(l.priceEach)} each`, ` · ${short(l.seller)} 的 ${l.quantity} 份 · 每份 ${okb(l.priceEach)}`)}</span>
                </span>
                {wallet?.toLowerCase() !== l.seller.toLowerCase() && (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`resale:${l.id}`, async (w) => {
                        await buyListing(publicClient, w, deployment!, l.id, 1, l.priceEach);
                        return L(`Bought one “${nameOf(l.design)}” from ${short(l.seller)}.`, `从 ${short(l.seller)} 那里买了一份「${nameOf(l.design)}」。`);
                      })
                    }
                  >
                    {L("Buy one", "买一份")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {wallet && owed !== null && owed > 0n && (
        <div className="row fashion-owed">
          <span>{L(`Waiting for you in the market: ${okb(owed)} from your sales.`, `市场里有你的卖出收入：${okb(owed)}。`)}</span>
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void run("withdraw", async (w) => (await withdrawProceeds(publicClient, w, deployment!), L(`Collected ${okb(owed)}.`, `已领取 ${okb(owed)}。`)))}>
            {L("Collect", "领取")}
          </button>
        </div>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
