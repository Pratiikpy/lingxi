/**
 * The item shop (plan 4.6, 4.9): things that live on X Layer. Four decorations and three limited outfits are sold for
 * BEM, the whole price burned; four decorations are keepsakes for wallets that helped finish a community goal,
 * claimed with a voucher our server signs. Pieces held can be placed at home or worn, and resold on the BEM market.
 * Cosmetic only.
 */

import { useEffect, useEffectEvent, useState } from "react";
import {
  type ShopItem,
  buyShopItem,
  claimVoucher,
  formatBem,
  listCopies,
  marketsOf,
  parseBem,
  readShopItems,
  shopBurned,
  shopReadiness,
  refusesTokens,
  type Deployment,
} from "@lingxi/chain";
import { WEARABLE } from "@lingxi/art";
import { CHAIN_DECOR, CHAIN_WEAR, DECOR_BY_ID, GOAL_BY_ID, isChainWear } from "@lingxi/world";
import { useLang, useT } from "../i18n";
import { accountOf, connectWallet, deployment, publicClient } from "../game/chain";
import { syncChainPieces } from "../game/chainDecor";
import { voucherQuery, withQuery } from "../game/requests";
import { useDesigns } from "../game/designs";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { DecorIcon } from "./DecorBar";
import "./itemshop.css";
import { errorText } from "../game/errorText";

type Lang = "en" | "zh";
const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");
/** one shared empty list, so the store selector returns the same value until something is held */
const NONE: readonly string[] = [];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The shop's shelf as X Layer holds it now, and the BEM it has burned. */
/** The deployment the shop sells from; the shop only shows its shelf when the deployment has one. */
const shopDeployment = (): Deployment => {
  if (!deployment?.itemShop) throw new Error("this deployment has no item shop");
  return deployment;
};

/** A shop piece's name after a sale: the world's name for it, or its id if the world does not know it, never no answer
 * to a purchase that went through. */
const pieceName = (piece: string): { en: string; zh: string } => DECOR_BY_ID[piece]?.name ?? { en: piece, zh: piece };

/** The fixed look of a wearable sold here: CHAIN_WEAR lists only pieces the art has. */
const wearOf = (id: string) => {
  const w = WEARABLE[id];
  if (!w) throw new Error(`no art for the wearable ${id}`);
  return w;
};

const readShelf = () =>
  Promise.all([readShopItems(publicClient, shopDeployment()), shopBurned(publicClient, shopDeployment())]);

export function ItemShopPanel() {
  const lang = useLang((s) => s.lang) as Lang;
  const t = useT();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const held = useWorld((s) => s.world.decor?.chainHeld) ?? NONE;
  const wornHeld = useWorld((s) => s.world.wardrobe?.chainHeld) ?? NONE;
  const [items, setItems] = useState<ShopItem[] | null>(null);
  const [burned, setBurned] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");
  const [resell, setResell] = useState<{ piece: string; price: string } | null>(null);
  const shop = deployment?.itemShop;

  const shelf = (list: ShopItem[], b: bigint) => {
    setItems(list);
    setBurned(b);
  };
  const unreadable = () => {
    setItems([]);
    setNote(L("The shop couldn't be read just now.", "暂时读不到道具店。"));
  };
  const read = () =>
    deployment?.itemShop ? readShelf().then(([list, b]) => shelf(list, b), unreadable) : Promise.resolve();
  // a wallet connected anywhere (the fashion market's button, a purchase) is read for pieces too
  const connected = useDesigns((s) => s.wallet);
  // the shelf is read once when the shop opens, and again after a purchase; a failure is said in the language of then
  const sayUnreadable = useEffectEvent(unreadable);
  useEffect(() => {
    if (!deployment?.itemShop) return;
    void readShelf().then(
      ([list, b]) => {
        setItems(list);
        setBurned(b);
      },
      () => sayUnreadable(),
    );
  }, []);
  useEffect(() => {
    void syncChainPieces(connected);
  }, [connected]);
  if (!shop) return null;

  const run = async (key: string, fn: (w: Awaited<ReturnType<typeof connectWallet>>) => Promise<string>) => {
    setBusy(key);
    setNote("");
    setStep("");
    try {
      const w = await connectWallet();
      setWallet(accountOf(w).address);
      const msg = await fn(w);
      await Promise.all([read(), syncChainPieces(accountOf(w).address)]);
      setNote(msg);
      play("success");
    } catch (e) {
      play("error");
      const m = errorText(e);
      setNote(
        m === "noWallet"
          ? L(
              "No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.",
              "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。",
            )
          : m === "notEnoughBem"
            ? L("This wallet doesn't hold enough BEM on X Layer for that.", "这个钱包在 X Layer 上的 BEM 不够。")
            : m === "notComplete"
              ? L(
                  "That goal isn't finished yet. The keepsake opens when everyone together reaches it.",
                  "这个目标还没完成。大家一起达成后才能领取纪念品。",
                )
              : refusesTokens(e)
                ? t("chain.cannotReceive")
                : m === "notContributor"
                  ? L(
                      "This wallet didn't add to that goal, so there is no keepsake for it.",
                      "这个钱包没有为这个目标出过力，所以没有它的纪念品。",
                    )
                  : L(`That didn't go through: ${m.split("\n")[0]}`, `没有成功：${m.split("\n")[0]}`),
      );
    }
    setBusy(null);
    setStep("");
  };

  const buy = (it: ShopItem) =>
    run(`buy:${it.piece}`, async (w) => {
      const r = await shopReadiness(publicClient, shopDeployment(), accountOf(w).address, it.price);
      if (!r.enough) throw new Error("notEnoughBem");
      setStep(
        r.needsApproval
          ? L(
              "Two steps in your wallet: first allow the shop to take exactly this much BEM, then buy.",
              "钱包里会有两步：先允许道具店取用正好这么多 BEM，再购买。",
            )
          : L("Confirm the purchase in your wallet.", "请在钱包里确认购买。"),
      );
      await buyShopItem(publicClient, w, shopDeployment(), it.id, 1, it.price);
      const wearable = WEARABLE[it.piece];
      if (wearable && isChainWear(it.piece))
        return L(
          `${wearable.name.en} is yours, and ${formatBem(it.price)} BEM was burned. Put it on from the wardrobe.`,
          `${wearable.name.zh}归你了，${formatBem(it.price)} BEM 已销毁。去衣橱穿上吧。`,
        );
      const name = pieceName(it.piece);
      return L(
        `${name.en} is yours, and ${formatBem(it.price)} BEM was burned. Place it from Decorate at home.`,
        `${name.zh}归你了，${formatBem(it.price)} BEM 已销毁。回家点「布置」就能摆上。`,
      );
    });

  const claim = (piece: string, goal: string) =>
    run(`claim:${piece}`, async (w) => {
      const who = accountOf(w).address;
      const res = await fetch(`${BASE}${withQuery("/api/voucher", voucherQuery(who, goal))}`);
      const body = (await res.json()) as {
        ok: boolean;
        reason?: string;
        voucher?: { to: `0x${string}`; id: string; quantity: number; nonce: string; expiresAt: string };
        signature?: `0x${string}`;
      };
      if (!body.ok || !body.voucher || !body.signature) throw new Error(body.reason ?? "voucher");
      setStep(L("Confirm the claim in your wallet (network fee only).", "请在钱包里确认领取（只需网络费）。"));
      const v = body.voucher;
      await claimVoucher(
        publicClient,
        w,
        shopDeployment(),
        { to: v.to, id: BigInt(v.id), quantity: v.quantity, nonce: BigInt(v.nonce), expiresAt: BigInt(v.expiresAt) },
        body.signature,
      );
      const name = pieceName(piece);
      return L(
        `${name.en} is in your wallet. Place it from Decorate at home.`,
        `${name.zh}已经在你的钱包里了。回家点「布置」就能摆上。`,
      );
    });

  const list = (piece: string, priceText: string) => {
    const each = parseBem(priceText);
    if (!each || each < 10_000n) {
      setNote(L("The lowest price on the market is 0.0001 BEM.", "市场上的最低价格是 0.0001 BEM。"));
      return;
    }
    const d = shopDeployment();
    const m = marketsOf(d).find((x) => x.v === 2);
    const item = d.items?.[piece];
    if (!m || item === undefined) {
      setNote(L("This piece can't be resold here yet.", "这件现在还不能在这里转卖。"));
      return;
    }
    const id = BigInt(item);
    void run(`list:${piece}`, async (w) => {
      await listCopies(publicClient, w, m, id, 1, each, { days: 30 });
      setResell(null);
      return L(
        `Listed one for ${formatBem(each)} BEM, for 30 days, in the fashion market's resales.`,
        `已挂出一份，${formatBem(each)} BEM，挂 30 天，在时装市场的转卖里。`,
      );
    });
  };

  const shopPieces = CHAIN_DECOR.filter((p) => p.chain?.kind === "shop");
  const keepsakes = CHAIN_DECOR.filter((p) => p.chain?.kind === "keepsake");
  const itemOf = (piece: string) => items?.find((i) => i.piece === piece);

  return (
    <div className="chainpanel itemshop">
      <p className="label">{L("Item shop", "道具店")}</p>
      <p className="small">
        {L(
          "Decorations that live on X Layer: held in your wallet, placed in your home, resold if you like. The whole price is burned; Lingxi keeps none of it. Cosmetic only.",
          "存在 X Layer 上的摆设：放在你的钱包里，摆在你的家里，也可以转卖。全部售价都会被销毁，灵犀一分不留。只是装饰，不影响玩法。",
        )}
      </p>
      {burned !== null && burned > 0n && (
        <p className="small fashion-burned">
          {L(`BEM burned by the shop so far: ${formatBem(burned)}`, `道具店至今已销毁 BEM：${formatBem(burned)}`)}
        </p>
      )}
      <ul className="itemshop-grid">
        {shopPieces.map((p) => (
          <ShopCard
            key={p.id}
            piece={p.id}
            icon={{ rows: p.rows, colors: p.colors }}
            name={p.name[lang]}
            supply={p.chain?.kind === "shop" ? p.chain.supply : 0}
            item={itemOf(p.id)}
            have={held.includes(p.id)}
            buyWhenHeld
            heldNote={L("In your wallet", "在你的钱包里")}
            resellDefault={5_000_000n}
            busy={busy}
            lang={lang}
            onBuy={(it) => void buy(it)}
            resell={resell}
            setResell={setResell}
            onList={list}
          />
        ))}
      </ul>
      <p className="label">{L("Limited outfits", "限量服饰")}</p>
      <p className="small">
        {L(
          "The Tape-out set: three pieces made only here, a fixed number of each, held in your wallet and worn from the wardrobe. All three together give the title “Tape-out engineer”. The whole price is burned. Looks only.",
          "流片套装：只在这里做的三件，每件数量固定，放在你的钱包里，在衣橱里穿。三件一起穿可得称号「流片工程师」。全部售价都会被销毁。只是好看。",
        )}
      </p>
      <ul className="itemshop-grid">
        {CHAIN_WEAR.map((p) => (
          <ShopCard
            key={p.id}
            piece={p.id}
            icon={{ rows: wearOf(p.id).rows, colors: wearOf(p.id).colors }}
            name={wearOf(p.id).name[lang]}
            supply={p.supply}
            item={itemOf(p.id)}
            have={wornHeld.includes(p.id)}
            buyWhenHeld={false}
            heldNote={L("In your wallet · wear it from the wardrobe", "在你的钱包里 · 去衣橱穿上")}
            resellDefault={10_000_000n}
            busy={busy}
            lang={lang}
            onBuy={(it) => void buy(it)}
            resell={resell}
            setResell={setResell}
            onList={list}
          />
        ))}
      </ul>
      <p className="label">{L("Keepsakes of the community goals", "社区目标纪念品")}</p>
      <p className="small">
        {L(
          "When a goal is finished, every wallet that helped can claim its keepsake once, paying only the network fee. Our server checks your part in the goal on X Layer and signs a voucher; the shop contract trusts that signature.",
          "目标完成后，每个出过力的钱包都能领取一次它的纪念品，只需付网络费。我们的服务器在 X Layer 上核对你的贡献并签发凭证；道具店合约信任这个签名。",
        )}
      </p>
      {!BASE && (
        <p className="small sp-warn">
          {L(
            "Claiming needs the web version at lingxi.knole.me, whose server signs the voucher.",
            "领取需要用网页版 lingxi.knole.me，由它的服务器签发凭证。",
          )}
        </p>
      )}
      <ul className="itemshop-grid">
        {keepsakes.map((p) => {
          const goal = p.chain?.kind === "keepsake" ? GOAL_BY_ID[p.chain.goal] : undefined;
          const have = held.includes(p.id);
          return (
            <li key={p.id} className="itemshop-card">
              <DecorIcon rows={p.rows} colors={p.colors} />
              <b>{p.name[lang]}</b>
              <span className="small">{goal ? L(`for “${goal.title.en}”`, `纪念「${goal.title.zh}」`) : ""}</span>
              {have ? (
                <span className="small fashion-have">{L("In your wallet", "在你的钱包里")}</span>
              ) : (
                BASE &&
                goal && (
                  <div className="fashion-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => void claim(p.id, goal.id)}
                    >
                      {busy === `claim:${p.id}` ? L("Claiming…", "领取中……") : L("Claim", "领取")}
                    </button>
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
      {wallet && <p className="small">{L(`Wallet ${short(wallet)}`, `钱包 ${short(wallet)}`)}</p>}
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

/**
 * One piece on the shop's shelf: its price in BEM (burned when bought) and how many are left, a Buy while any are left
 * (a limited outfit only while the wallet holds none), and, once held, listing one for resale.
 */
function ShopCard({
  piece,
  icon,
  name,
  supply,
  item,
  have,
  buyWhenHeld,
  heldNote,
  resellDefault,
  busy,
  lang,
  onBuy,
  resell,
  setResell,
  onList,
}: {
  piece: string;
  icon: { rows: readonly string[]; colors: Record<string, string> };
  name: string;
  supply: number;
  /** the shop's item for this piece, once read */
  item: ShopItem | undefined;
  /** the wallet holds one */
  have: boolean;
  /** whether another may be bought while one is held */
  buyWhenHeld: boolean;
  heldNote: string;
  /** the price a resale starts at when the shop's own price is not known, in BEM's smallest unit */
  resellDefault: bigint;
  busy: string | null;
  lang: Lang;
  onBuy: (it: ShopItem) => void;
  resell: { piece: string; price: string } | null;
  setResell: (r: { piece: string; price: string } | null) => void;
  onList: (piece: string, price: string) => void;
}) {
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const it = item;
  return (
    <li className="itemshop-card">
      <DecorIcon rows={icon.rows} colors={icon.colors} />
      <b>{name}</b>
      <span className="small">
        {it
          ? it.price > 0n
            ? L(`${formatBem(it.price)} BEM, burned`, `${formatBem(it.price)} BEM，全部销毁`)
            : L("not on sale", "暂不出售")
          : L("reading…", "读取中……")}
      </span>
      {it && (
        <span className="small">
          {L(`${it.available.toString()} of ${supply} left`, `还剩 ${it.available.toString()}/${supply}`)}
        </span>
      )}
      {have && <span className="small fashion-have">{heldNote}</span>}
      <div className="fashion-actions">
        {it && it.price > 0n && it.available > 0n && (buyWhenHeld || !have) && (
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => onBuy(it)}>
            {busy === `buy:${piece}` ? L("Buying…", "购买中……") : L("Buy", "购买")}
          </button>
        )}
        {have && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              setResell(resell?.piece === piece ? null : { piece, price: formatBem(it?.price ?? resellDefault) })
            }
          >
            {L("Resell", "转卖")}
          </button>
        )}
      </div>
      {resell?.piece === piece && (
        <form
          className="fashion-resell"
          onSubmit={(e) => {
            e.preventDefault();
            onList(piece, resell.price);
          }}
        >
          <input
            inputMode="decimal"
            value={resell.price}
            onChange={(e) => setResell({ ...resell, price: e.target.value.replace(/[^0-9.]/g, "") })}
            aria-label={L("Price (BEM)", "价格（BEM）")}
          />
          <button type="submit" className="btn primary" disabled={busy !== null}>
            {L("List one", "挂出一份")}
          </button>
        </form>
      )}
    </li>
  );
}
