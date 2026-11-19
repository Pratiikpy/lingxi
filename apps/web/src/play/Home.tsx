/**
 * A home of its own (PRD Z4): at adulthood, the owner may open the TapeOut
 * container of a circuit they hold, the pet's own brain taped out by them, as
 * the pet's home. The cost is read from the chain and shown first; skipping it
 * loses nothing in play. An open home can hold keepsakes (circuits sent into
 * it). Letters between homes (Z5) use TapeSend, which opens here as soon as its
 * hub accepts circuits on this processor.
 */

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { type Home, HomeError, homeCallFee, keepOutfitAtHome, takeOutfitFromHome, homePageHtml, homeSiteName, homeSiteUrl, lettersStatus, moveIntoHome, nameFee, openHome, openingFee, processorIndex, publishHomePage, readHome, readHomePage, readMetadata, type OutfitDesign, wearKey } from "@lingxi/chain";
import { type Pet, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient, recordOf, useChain } from "../game/chain";
import { play } from "../game/sound";
import { marketAvailable, marketOf, useDesigns } from "../game/designs";
import { now } from "../game/gameClock";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function HomePanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const record = useChain((s) => s.record) ?? recordOf(pet);
  const [home, setHome] = useState<Home | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [letters, setLetters] = useState<"open" | "processor" | "hub" | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [keep, setKeep] = useState("");
  const stage = stageOf(pet, now());
  const grown = stage === "adult" || stage === "elder";
  const deed = record?.brainKey ? record.brains?.[record.brainKey] : undefined;

  // the home as X Layer holds it now, the opening fee, and whether letters between homes can open (A12)
  const readAll = useCallback(() => Promise.all([readHome(publicClient, deployment!.processor, BigInt(deed!)), openingFee(publicClient), lettersStatus(publicClient, deployment!.processor)]), [deed]);
  const show = useCallback(([h, f, ok]: Awaited<ReturnType<typeof readAll>>) => {
    setHome(h);
    setFee(f);
    setLetters(ok);
    setState("ready");
  }, []);
  const load = useCallback(() => {
    if (!deployment || !deed) return Promise.resolve();
    setState("loading");
    return readAll().then(show, () => setState("error"));
  }, [deed, readAll, show]);
  // read when the panel opens on a grown pet (it starts out loading)
  useEffect(() => {
    if (!grown || !record || !deployment || !deed) return;
    let live = true;
    readAll().then(
      (r) => live && show(r),
      () => live && setState("error"),
    );
    return () => {
      live = false;
    };
  }, [grown, record, deed, readAll, show]);

  if (!record || !deployment) return null;
  const holds = home && home.holder.toLowerCase() === record.owner.toLowerCase();

  const open = async () => {
    if (!home) return;
    setBusy(true);
    setNote("");
    try {
      const wallet = await connectWallet();
      await openHome(publicClient, wallet, deployment!.processor, home.circuit);
      play("success");
      setNote(L(`${pet.name} has a home of its own.`, `${pet.name}有了自己的家。`));
      await load();
    } catch (e) {
      play("error");
      setNote(e instanceof HomeError && e.code === "notHolder" ? L("Only the wallet that holds the deed can open the home.", "只有持有房契的钱包才能开通这个家。") : L("That didn't go through. Nothing was charged; try again.", "没有成功，也没有扣费，请再试一次。"));
    }
    setBusy(false);
  };

  const move = async () => {
    if (!home || !/^\d{1,9}$/.test(keep.trim())) {
      setNote(L("Give the number of a circuit you hold, such as a season keepsake.", "请填一个你持有的电路编号，比如赛季纪念电路。"));
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const wallet = await connectWallet();
      await moveIntoHome(publicClient, wallet, deployment!.processor, BigInt(keep.trim()), home);
      play("success");
      setNote(L(`Circuit #${keep.trim()} is now kept in ${pet.name}'s home.`, `#${keep.trim()} 号电路现在放在${pet.name}的家里了。`));
      setKeep("");
    } catch (e) {
      play("error");
      setNote(e instanceof HomeError && e.code === "notHolder" ? L("Your wallet doesn't hold that circuit.", "你的钱包没有持有这个电路。") : L("That didn't go through. Try again.", "没有成功，请再试一次。"));
    }
    setBusy(false);
  };

  return (
    <div className="chainpanel home">
      <p className="label">{L("A home of its own", "自己的家")}</p>
      {!grown ? (
        <p className="small">{L(`When ${pet.name} grows up, you can open a home for it on X Layer: a TapeOut container that keeps its keepsakes and, later, its letters.`, `${pet.name}长大以后，你可以在 X Layer 上为它开一个家：一个 TapeOut 容器，用来放纪念品，以后还能收信。`)}</p>
      ) : !deed ? (
        <p className="small">{L(`A home is the container of a circuit you hold. Save ${pet.name}'s brain on chain first.`, `家是你持有的一块电路的容器。请先把${pet.name}的大脑存上链。`)}</p>
      ) : state === "loading" ? (
        <p className="small">{L("Reading its home from X Layer…", "正在从 X Layer 读取它的家……")}</p>
      ) : state === "error" ? (
        <p className="small">
          {L("X Layer couldn't be reached.", "暂时连不上 X Layer。")}{" "}
          <button type="button" className="link" onClick={() => void load()}>
            {L("Retry", "重试")}
          </button>
        </p>
      ) : !holds ? (
        <p className="small">{L(`A home is the container of a circuit you hold, and ${pet.name}'s current brain circuit is a shared one. Tape its brain out yourself (above) and that circuit becomes the home's deed.`, `家是你持有的一块电路的容器，而${pet.name}现在的大脑电路是共用的。请在上面自己流片它的大脑，那块电路就成为这个家的房契。`)}</p>
      ) : !home!.opened ? (
        <>
          <p className="small">
            {L(
              `Its home will be the container of circuit #${home!.circuit} (its brain, which you hold), at ${short(home!.container)}. Opening it is TapeOut's one-time step: ${fee !== null ? formatEther(fee) : "…"} OKB plus network gas. Skipping it loses nothing in play.`,
              `它的家是 #${home!.circuit} 号电路（你持有的它的大脑）的容器，地址 ${short(home!.container)}。开通是 TapeOut 的一次性步骤：${fee !== null ? formatEther(fee) : "…"} OKB 加网络手续费。不开通也不影响任何玩法。`,
            )}
          </p>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void open()}>
            {busy ? L("Opening…", "开通中……") : L(`Open ${pet.name}'s home`, `为${pet.name}开通家`)}
          </button>
        </>
      ) : (
        <>
          <p className="small">
            {L(`${pet.name}'s home is open: the container of circuit #${home!.circuit}, at`, `${pet.name}的家已开通：#${home!.circuit} 号电路的容器，地址`)}{" "}
            <a href={`https://www.oklink.com/xlayer/address/${home!.container}`} target="_blank" rel="noopener noreferrer">
              {short(home!.container)}
            </a>
            .
          </p>
          <form
            className="home-keep"
            onSubmit={(e) => {
              e.preventDefault();
              void move();
            }}
          >
            <input value={keep} onChange={(e) => setKeep(e.target.value)} inputMode="numeric" placeholder={L("Circuit number, e.g. a season keepsake", "电路编号，比如赛季纪念电路")} aria-label={L("Circuit to keep in its home", "要放进家里的电路")} />
            <button type="submit" className="btn" disabled={busy || !keep.trim()}>
              {L("Keep it at home", "放进家里")}
            </button>
          </form>
          <HomePage pet={pet} home={home!} petId={record.petId} />
          <HomeOutfits pet={pet} home={home!} />
          <p className="small">
            {letters === "open"
              ? L("Letters between homes are coming next.", "家与家之间的信件即将开放。")
              : letters === "hub"
                ? L("Letters between homes go through TapeSend's hub, which now runs code TapeKit has not approved, so Lingxi keeps letters closed until it is.", "家与家之间的信件走 TapeSend 的中枢，它现在运行的代码还没有得到 TapeKit 认可，所以灵犀先不开放信件，等认可之后再开。")
                : L("Letters between homes go through TapeSend, whose hub does not yet accept circuits from Lingxi's processor. They open here as soon as it does.", "家与家之间的信件走 TapeSend，它的中枢目前还不接受灵犀处理器上的电路。一旦接受，这里就会开放。")}
          </p>
        </>
      )}
      {note && (
        <p className="small" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

/** Z4: a page of its own, published into the home and named `<circuit>.2.<processor>.tape` on DeWEB. */
function HomePage({ pet, home, petId }: { pet: Pet; home: Home; petId: string }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [site, setSite] = useState<{ index: number; live: boolean; published: boolean; fee: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // the page as DeWEB holds it now: the processor's index, whether it is published and live, and the name fee
  const readSite = useCallback(async () => {
    const index = await processorIndex(publicClient, deployment!.processor, deployment!.processorIndex);
    const [s, fee] = await Promise.all([readHomePage(publicClient, home.container, homeSiteName(home.circuit, index)), nameFee(publicClient)]);
    return { index, live: s.live, published: s.published, fee };
  }, [home.container, home.circuit]);
  const read = () => readSite().then(setSite, () => setSite(null));
  useEffect(() => {
    if (!deployment) return;
    let live = true;
    readSite().then(
      (s) => live && setSite(s),
      () => live && setSite(null),
    );
    return () => {
      live = false;
    };
  }, [readSite]);
  if (!site || !deployment) return null;
  const name = homeSiteName(home.circuit, site.index);
  const url = homeSiteUrl(home.circuit, site.index);
  const publish = async () => {
    setBusy(true);
    setNote("");
    try {
      const wallet = await connectWallet();
      const meta = await readMetadata(publicClient, deployment!, BigInt(petId)).catch(() => null);
      const html = homePageHtml({
        petId: BigInt(petId),
        name: meta?.name || pet.name,
        ...(meta?.image ? { image: meta.image } : {}),
        registry: deployment!.registry,
        rpc: deployment!.rpc,
        proofUrl: `https://lingxi.knole.me/verify.html#${petId}`,
        siteName: name,
      });
      await publishHomePage(publicClient, wallet, home.container, name, html);
      play("success");
      setNote(L(`${pet.name}'s page is live at ${name}.`, `${pet.name}的页面已上线：${name}。`));
      await read();
    } catch (e) {
      play("error");
      setNote((e as Error).message === "noWallet" ? L("No wallet found in this browser.", "这个浏览器里没有钱包。") : L("That didn't go through. Only the deed's holder can write the home's page; try again.", "没有成功。只有房契持有人能写这个家的页面，请再试一次。"));
    }
    setBusy(false);
  };
  return (
    <div className="home-page">
      <p className="small">
        {site.published && site.live ? (
          <>
            {L(`${pet.name} has its own address on DeWEB:`, `${pet.name}在 DeWEB 上有自己的地址：`)}{" "}
            <a href={url} target="_blank" rel="noopener noreferrer">
              {name}
            </a>
          </>
        ) : (
          L(
            `Give ${pet.name} a page of its own at ${name}: its picture, name and live numbers from X Layer, served from its home. ${site.fee > 0n ? `The name costs ${formatEther(site.fee)} OKB for ten years, plus` : "The name is free; you pay only"} network gas for a few writes.`,
            `给${pet.name}一个自己的页面，地址 ${name}：放着它的样子、名字和从 X Layer 实时读取的数字，就存在它的家里。${site.fee > 0n ? `名字十年 ${formatEther(site.fee)} OKB，另加` : "名字免费，只需要"}几笔写入的网络手续费。`,
          )
        )}
      </p>
      <button type="button" className="btn" disabled={busy} onClick={() => void publish()}>
        {busy ? L("Publishing…", "发布中……") : site.published ? L("Update its page", "更新它的页面") : L("Publish its page", "发布它的页面")}
      </button>
      {note && (
        <p className="small" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}

/** Z4: outfits kept in the home stay wearable; taking one back is a call from the home, which TapeOut charges for. */
function HomeOutfits({ pet, home }: { pet: Pet; home: Home }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { market, held, atHome, wallet, setHome, refresh } = useDesigns();
  const [fee, setFee] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    setHome(home.container);
    void homeCallFee(publicClient, home).then(setFee, () => setFee(null));
    return () => setHome(null);
  }, [home, setHome]);
  if (!marketAvailable()) return null;
  const mine = market.filter((m) => !m.item && ((held[wearKey(m.market, m.id)] ?? 0) > 0 || (atHome[wearKey(m.market, m.id)] ?? 0) > 0));
  const act = async (m: OutfitDesign, out: boolean) => {
    const id = m.id;
    const mk = marketOf(m.market)!;
    setBusy(wearKey(m.market, id));
    setNote("");
    try {
      const w = await connectWallet();
      if (out) await takeOutfitFromHome(publicClient, w, mk.address, id, home);
      else await keepOutfitAtHome(publicClient, w, mk.address, id, home);
      play("success");
      await refresh(w.account!.address);
    } catch (e) {
      play("error");
      setNote(e instanceof HomeError && e.code === "notHolder" ? L("Only the deed's holder can move outfits in and out.", "只有房契持有人能把衣服放进去或拿出来。") : L("That didn't go through. Try again.", "没有成功，请再试一次。"));
    }
    setBusy(null);
  };
  return (
    <div className="home-outfits">
      <p className="small">
        {L(`Outfits kept in ${pet.name}'s home stay wearable. Putting one in costs only gas; taking one out is a call from the home, which TapeOut charges ${fee !== null ? formatEther(fee) : "…"} OKB for, plus gas.`, `放在${pet.name}家里的衣服照样能穿。放进去只要网络手续费；拿出来是从家里发起的一笔调用，TapeOut 收 ${fee !== null ? formatEther(fee) : "…"} OKB，另加手续费。`)}
      </p>
      {!wallet ? (
        <button type="button" className="btn" onClick={() => void connectWallet().then((w) => refresh(w.account!.address), () => setNote(L("No wallet found in this browser.", "这个浏览器里没有钱包。")))}>
          {L("Show my outfits", "看看我的衣服")}
        </button>
      ) : mine.length === 0 ? (
        <p className="small">{L("You don't hold any outfits from the fashion market yet.", "你还没有时装市场里的衣服。")}</p>
      ) : (
        <ul className="home-outfit-list">
          {mine.map((m) => {
            const k = wearKey(m.market, m.id);
            return (
              <li key={k}>
                <span>
                  {m.name} <span className="small">{L(`${held[k] ?? 0} with you · ${atHome[k] ?? 0} at home`, `身上 ${held[k] ?? 0} · 家里 ${atHome[k] ?? 0}`)}</span>
                </span>
                {(held[k] ?? 0) > 0 && (
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => void act(m, false)}>
                    {busy === k ? "…" : L("Keep at home", "放进家里")}
                  </button>
                )}
                {(atHome[k] ?? 0) > 0 && (
                  <button type="button" className="btn" disabled={busy !== null} onClick={() => void act(m, true)}>
                    {busy === k ? "…" : L("Take back", "拿回来")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {note && (
        <p className="small" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}
