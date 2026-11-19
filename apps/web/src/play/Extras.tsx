/**
 * Paid extras (plan 4.9): more room at home, more saved looks, and a colour for the pet's name, each 0.05 BEM and
 * burned whole by the Extras contract. Below them, the wallets linked to this home, so visitors see what they hold.
 * Nothing here changes how a pet thinks, plays or earns.
 */

import type React from "react";
import { useEffect, useState } from "react";
import type { WalletClient } from "viem";
import { formatBem } from "@lingxi/chain";
import { type Pet } from "@lingxi/game";
import { LOOKS_MAX, MAX_PACKS, NAME_COLOURS, ROOM_MAX, extrasOf, lookLimit, roomCapacity, savedLooks } from "@lingxi/world";
import { useLang } from "../i18n";
import { connectWallet, deployment, useChain } from "../game/chain";
import { buyRoomOrLooks, extrasLive, linkWallet, loadColours, setNameColour, syncPacks, unlinkWallet, useExtras } from "../game/extras";
import { useDesigns } from "../game/designs";
import { liveAvailable, useLive } from "../game/live";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PetName } from "./PetName";
import { type SourceState, sourcifyPage, sourcifyState } from "../game/sourcify";
import "./extras.css";
import { errorText } from "../game/errorText";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Packs({ n, label }: { n: number; label: string }) {
  return (
    <span className="extras-packs" role="img" aria-label={label}>
      {Array.from({ length: MAX_PACKS }, (_, i) => (
        <i key={i} className={i < n ? "on" : ""} />
      ))}
    </span>
  );
}

/** The contract's address and what Sourcify says about its source, asked when the panel opens. */
function ContractSource({ address, lang }: { address: `0x${string}`; lang: Lang }) {
  const [state, setState] = useState<SourceState | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    void sourcifyState(address, ctl.signal).then((s) => !ctl.signal.aborted && setState(s));
    return () => ctl.abort();
  }, [address]);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const said: Record<SourceState, string> = {
    exact: L("source verified on Sourcify", "源码已在 Sourcify 验证"),
    partial: L("source only partly matches on Sourcify", "Sourcify 上的源码只部分匹配"),
    none: L("source not yet verified", "源码尚未验证"),
    unreachable: L("Sourcify could not be reached", "连不上 Sourcify"),
  };
  return (
    <p className="small">
      {L(`Contract ${short(address)} on X Layer, `, `X Layer 上的合约 ${short(address)}，`)}
      {state ? (
        <a href={sourcifyPage(address)} target="_blank" rel="noopener noreferrer">
          {said[state]}
        </a>
      ) : (
        L("checking its source…", "正在核对源码……")
      )}
      {L(".", "。")}
    </p>
  );
}
export function ExtrasPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const terms = useExtras((s) => s.terms);
  const record = useChain((s) => s.record);
  const petId = record?.petId ?? null;
  const current = useExtras((s) => (petId ? (s.colours[petId] ?? 0) : 0));
  const links = useLive((s) => s.links);
  const connected = useDesigns((s) => s.wallet);
  // the colour picked starts as the pet's colour on chain, and follows it when that changes
  const [pick, setPick] = useState<number>(current);
  const [pickedFrom, setPickedFrom] = useState(current);
  if (current !== pickedFrom) {
    setPickedFrom(current);
    setPick(current);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void syncPacks(connected);
  }, [connected]);
  useEffect(() => {
    if (petId) void loadColours([petId]);
  }, [petId]);
  if (!extrasLive()) return null;

  const packs = extrasOf(world);
  const run = async (key: string, fn: (w: WalletClient) => Promise<string>) => {
    setBusy(key);
    setNote("");
    setStep("");
    try {
      const w = await connectWallet();
      // the wardrobe and the shop read this wallet too: its outfit copies, its pieces, its packs
      void useDesigns.getState().refresh(w.account!.address);
      setNote(await fn(w));
      play("success");
    } catch (e) {
      play("error");
      const m = errorText(e);
      setNote(
        m === "noWallet"
          ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。")
          : m === "notEnoughBem"
            ? L("This wallet doesn't hold enough BEM on X Layer for that.", "这个钱包在 X Layer 上的 BEM 不够。")
            : m === "notOwner" || /NotPetOwner/.test(m)
              ? L(`${pet.name} belongs to wallet ${short(record?.owner ?? "")}. Connect that wallet to colour its name.`, `${pet.name}属于钱包 ${short(record?.owner ?? "")}。请连接那个钱包来给名字上色。`)
              : /\bFull\(\)/.test(m)
                ? L("This wallet already has all three.", "这个钱包三份都已经有了。")
                : /PriceMoved/.test(m)
                  ? L("The price changed a moment ago. Nothing was taken; look at the new price and try again.", "价格刚刚变了。没有扣任何东西，请看看新价格再试。")
                  : /User rejected|denied/i.test(m)
                    ? L("Nothing was signed, so nothing changed.", "没有签名，所以什么都没变。")
                    : L(`That didn't go through: ${m.split("\n")[0]}`, `没有成功：${m.split("\n")[0]}`),
      );
    }
    setBusy(null);
    setStep("");
  };

  const twoSteps = L("Two steps in your wallet: first allow exactly this much BEM, then confirm.", "钱包里会有两步：先允许正好这么多 BEM，再确认。");
  const buy = (kind: "room" | "looks") =>
    run(kind, async (w) => {
      const price = terms!.price[kind];
      setStep(twoSteps);
      await buyRoomOrLooks(w, kind, price);
      return kind === "room"
        ? L(`Your home now holds ${roomCapacity(useWorld.getState().world)} pieces, and ${formatBem(price)} BEM was burned.`, `你的家现在能摆 ${roomCapacity(useWorld.getState().world)} 件，${formatBem(price)} BEM 已销毁。`)
        : L(`You can now keep ${lookLimit(useWorld.getState().world)} looks, and ${formatBem(price)} BEM was burned.`, `你现在能存 ${lookLimit(useWorld.getState().world)} 套搭配，${formatBem(price)} BEM 已销毁。`);
    });

  const colour = (c: number) =>
    run(`colour:${c}`, async (w) => {
      if (!petId || !record) throw new Error("noRecord");
      if (w.account!.address.toLowerCase() !== record.owner.toLowerCase()) throw new Error("notOwner");
      const price = terms!.price.colour;
      setStep(c === 0 ? L("Confirm in your wallet (network fee only).", "请在钱包里确认（只需网络费）。") : twoSteps);
      await setNameColour(w, petId, c, price);
      const name = NAME_COLOURS.find((x) => x.id === c)?.name;
      return c === 0
        ? L(`${pet.name}'s name is plain again.`, `${pet.name}的名字恢复成普通颜色了。`)
        : L(`${pet.name}'s name is ${name!.en} now, and ${formatBem(price)} BEM was burned.`, `${pet.name}的名字现在是${name!.zh}，${formatBem(price)} BEM 已销毁。`);
    });

  const link = () =>
    run("link", async (w) => {
      setStep(L("Sign the message in your wallet. It is not a transaction and costs nothing.", "请在钱包里签名。这不是交易，不花任何费用。"));
      const r = await linkWallet(w);
      if (!r.ok) {
        const why: Record<string, [string, string]> = {
          full: ["Four wallets are already linked. Unlink one first.", "已经连了四个钱包，请先解除一个。"],
          serverFull: ["The server holds as many homes with wallets as it can just now. Try again later.", "服务器上连了钱包的家已经满了，请稍后再试。"],
          tooMany: ["This address has started enough new homes today. Try again tomorrow.", "这个网络地址今天开的新家已经够多了，明天再试吧。"],
          key: ["This device doesn't hold this home's key, so it can't link a wallet to it.", "这台设备没有这个家的钥匙，不能给它连钱包。"],
          noAnswer: ["The server didn't answer. Try again in a moment.", "服务器没有回应，请稍后再试。"],
        };
        const [en, zh] = why[r.reason ?? ""] ?? ["The signature wasn't accepted.", "签名没有被接受。"];
        throw new Error(L(en, zh));
      }
      return L(`Linked ${short(w.account!.address)}. Visitors now see what it holds.`, `已连接 ${short(w.account!.address)}。访客现在能看到它持有的东西了。`);
    });

  const unlink = async (a: string) => {
    setBusy(`unlink:${a}`);
    const r = await unlinkWallet(a);
    setNote(r.ok ? L(`Unlinked ${short(a)}.`, `已解除 ${short(a)}。`) : L("That didn't go through. Try again.", "没有成功，请再试一次。"));
    setBusy(null);
  };

  const price = (k: "room" | "looks" | "colour") => (terms ? (terms.price[k] > 0n ? L(`${formatBem(terms.price[k])} BEM, burned`, `${formatBem(terms.price[k])} BEM，全部销毁`) : L("not on sale", "暂不出售")) : L("reading…", "读取中……"));
  const placed = world.decor?.placed.length ?? 0;
  const looks = savedLooks(world).length;

  return (
    <div className="chainpanel extras">
      <p className="label">{L("Extras", "小额外")}</p>
      <p className="small">
        {L(
          "A little more room, more saved looks, a colour for a name. Each is paid in BEM on X Layer and the whole price is burned; Lingxi keeps none of it. Nothing here changes how a pet thinks, plays or earns.",
          "多一点空间、多存几套搭配、给名字一个颜色。每样都在 X Layer 上用 BEM 付，全部售价都会销毁，灵犀一分不留。这里的东西都不影响宠物怎么思考、玩耍或赚钱。",
        )}
      </p>

      <div className="extras-row">
        <div>
          <b>{L("Room space", "房间空间")}</b>
          <p className="small">{L(`${placed} of ${roomCapacity(world)} pieces placed at home. Each pack adds 4, up to ${ROOM_MAX}.`, `家里已摆 ${placed}/${roomCapacity(world)} 件。每份多 4 件，最多 ${ROOM_MAX} 件。`)}</p>
          <p className="small">{price("room")}</p>
          <Packs n={packs.room} label={L(`${packs.room} of 3 bought`, `已买 ${packs.room}/3 份`)} />
        </div>
        {packs.room < MAX_PACKS && terms && terms.price.room > 0n && (
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void buy("room")}>
            {busy === "room" ? L("Buying…", "购买中……") : L("+4 pieces", "+4 件")}
          </button>
        )}
      </div>

      <div className="extras-row">
        <div>
          <b>{L("Saved looks", "存搭配")}</b>
          <p className="small">{L(`${looks} of ${lookLimit(world)} looks kept in the wardrobe. Each pack adds 3, up to ${LOOKS_MAX}.`, `衣橱里存了 ${looks}/${lookLimit(world)} 套。每份多 3 套，最多 ${LOOKS_MAX} 套。`)}</p>
          <p className="small">{price("looks")}</p>
          <Packs n={packs.looks} label={L(`${packs.looks} of 3 bought`, `已买 ${packs.looks}/3 份`)} />
        </div>
        {packs.looks < MAX_PACKS && terms && terms.price.looks > 0n && (
          <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void buy("looks")}>
            {busy === "looks" ? L("Buying…", "购买中……") : L("+3 looks", "+3 套")}
          </button>
        )}
      </div>

      <div className="extras-row" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <b>{L("Name colour", "名字颜色")}</b>
          {!petId ? (
            <p className="small">{L(`Save ${pet.name} on X Layer first: the colour is kept with the pet on chain, and stays if it ever changes hands.`, `请先把${pet.name}存上 X Layer：颜色跟着链上的宠物，换主人也会留着。`)}</p>
          ) : (
            <>
              <p className="small">{L("Kept with the pet on X Layer, shown wherever its name is. Going back to plain is free.", "颜色记在 X Layer 上的宠物身上，名字出现的地方都会显示。改回普通颜色免费。")}</p>
              <p className="small">{price("colour")}</p>
              <p className="extras-preview" aria-live="polite">
                <PetName name={pet.name} colour={pick} />
              </p>
              <ul className="extras-swatches" role="group" aria-label={L("Colours", "颜色")}>
                <li>
                  <button type="button" className="extras-swatch" aria-pressed={pick === 0} onClick={() => (play("tap"), setPick(0))}>
                    <i className="dot" style={{ background: "var(--ink)" } as React.CSSProperties} />
                    {L("Plain", "普通")}
                  </button>
                </li>
                {NAME_COLOURS.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="extras-swatch" aria-pressed={pick === c.id} style={{ "--nc-l": c.light, "--nc-d": c.dark } as React.CSSProperties} onClick={() => (play("tap"), setPick(c.id))}>
                      <i className="dot" />
                      <span className="pet-named">{c.name[lang]}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {pick !== current && (pick === 0 || (terms && terms.price.colour > 0n)) && (
                <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void colour(pick)}>
                  {busy?.startsWith("colour") ? L("Saving…", "保存中……") : pick === 0 ? L("Back to plain, free", "改回普通，免费") : L(`Colour it · ${terms ? formatBem(terms.price.colour) : ""} BEM`, `上色 · ${terms ? formatBem(terms.price.colour) : ""} BEM`)}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {liveAvailable() && (
        <div className="extras-row" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <b>{L("Show it to visitors", "让访客看到")}</b>
            <p className="small">
              {L(
                "Friends who visit see your on-chain pieces, extra room space and name colours once the wallet that holds them is linked to your home. Linking is a signature, not a transaction, and costs nothing.",
                "把持有它们的钱包连到你的家以后，来串门的朋友就能看到你的链上摆设、多出的空间和名字颜色。连接只是签名，不是交易，不花任何费用。",
              )}
            </p>
            {links && links.length > 0 && (
              <ul className="extras-wallets">
                {links.map((a) => (
                  <li key={a}>
                    <span>{short(a)}</span>
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void unlink(a)}>
                      {L("Unlink", "解除")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn" disabled={busy !== null || (links?.length ?? 0) >= 4} onClick={() => void link()}>
              {busy === "link" ? L("Linking…", "连接中……") : L("Link a wallet", "连接钱包")}
            </button>
          </div>
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
      {deployment?.extras && <ContractSource address={deployment.extras} lang={lang} />}
    </div>
  );
}
