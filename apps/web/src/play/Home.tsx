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
import { type Home, HomeError, hubAccepts, moveIntoHome, openHome, openingFee, readHome } from "@lingxi/chain";
import { type Pet, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient, recordOf, useChain } from "../game/chain";
import { play } from "../game/sound";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function HomePanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const record = useChain((s) => s.record) ?? recordOf(pet);
  const [home, setHome] = useState<Home | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [letters, setLetters] = useState<boolean | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [keep, setKeep] = useState("");
  const stage = stageOf(pet, Date.now());
  const grown = stage === "adult" || stage === "elder";
  const deed = record?.brainKey ? record.brains?.[record.brainKey] : undefined;

  const load = useCallback(async () => {
    if (!deployment || !deed) return;
    setState("loading");
    try {
      const [h, f, ok] = await Promise.all([readHome(publicClient, deployment.processor, BigInt(deed)), openingFee(publicClient), hubAccepts(publicClient, deployment.processor)]);
      setHome(h);
      setFee(f);
      setLetters(ok);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [deed]);
  useEffect(() => {
    if (grown && record) void load();
  }, [grown, record, load]);

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
          <p className="small">
            {letters
              ? L("Letters between homes are coming next.", "家与家之间的信件即将开放。")
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
