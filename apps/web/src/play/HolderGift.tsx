/**
 * The holder pin (plan 4.12): a free outfit for holders of TapeCode-Test1, a TapeOut Rig, or BEM or FAB at the
 * snapshot block. The wallet is read first, so the screen says which way it can claim before anything is signed;
 * a Test1 holder types their token's number (the collection cannot list tokens by owner) and it is checked on
 * chain. The snapshot file is used only when its rebuilt root equals the gift contract's.
 */

import { useEffect, useState } from "react";
import { type GiftTerms, type GiftWay, type Snapshot, type SnapshotFile, checkTest1, claimGift, formatBem, giftClaimed, giftTerms, giftWays, loadSnapshot } from "@lingxi/chain";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import { connectWallet, deployment, publicClient } from "../game/chain";
import { useDesigns } from "../game/designs";
import { play } from "../game/sound";
import { OnPet } from "./FashionMarket";

type Lang = "en" | "zh";
const WAY_NAME: Record<GiftWay["label"], { en: string; zh: string }> = {
  test1: { en: "your TapeCode-Test1", zh: "你的 TapeCode-Test1" },
  rig: { en: "your TapeOut Rig", zh: "你的 TapeOut 矿机" },
  bem: { en: "your BEM", zh: "你持有的 BEM" },
  fab: { en: "your FAB", zh: "你持有的 FAB" },
};

export function HolderGiftPanel({ pet, wallet }: { pet: Pet; wallet: string }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const refreshDesigns = useDesigns((s) => s.refresh);
  const [terms, setTerms] = useState<GiftTerms | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [ways, setWays] = useState<GiftWay[]>([]);
  const [snapDate, setSnapDate] = useState<Date | null>(null);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!deployment?.holderGift) return;
    let live = true;
    void (async () => {
      try {
        const t = await giftTerms(publicClient, deployment!);
        if (!t || !live) return;
        const who = wallet as `0x${string}`;
        // the snapshot of BEM and FAB holders ships with the site; a file that does not match the contract is ignored
        let snap: Snapshot | null = null;
        try {
          const file = (await (await fetch(new URL("holder-snapshot.json", document.baseURI))).json()) as SnapshotFile;
          snap = loadSnapshot(file, t);
        } catch {
          snap = null;
        }
        const [c, w, blk] = await Promise.all([giftClaimed(publicClient, t, who), giftWays(publicClient, t, who, snap), publicClient.getBlock({ blockNumber: t.snapshotBlock }).catch(() => null)]);
        if (!live) return;
        setSnapDate(blk ? new Date(Number(blk.timestamp) * 1000) : null);
        setTerms(t);
        setClaimed(c);
        setWays(w);
      } catch {
        if (live) setNote(L("The holder pin couldn't be read just now.", "暂时读不到持有人徽章。"));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  if (!deployment?.holderGift || !terms) return note ? <p className="small sp-warn">{note}</p> : null;

  const claim = async (way: GiftWay) => {
    setBusy(true);
    setNote("");
    try {
      const w = await connectWallet();
      if (w.account!.address.toLowerCase() !== wallet.toLowerCase()) throw new Error("wallet changed");
      await claimGift(publicClient, w, terms, way);
      setClaimed(true);
      await refreshDesigns(w.account!.address);
      setNote(L(`The holder pin is yours, claimed through ${WAY_NAME[way.label].en}. Wear it from the wardrobe.`, `持有人徽章归你了（凭${WAY_NAME[way.label].zh}领取）。去衣橱里穿上它吧。`));
      play("success");
    } catch (e) {
      play("error");
      setNote(L(`That didn't go through: ${(e as Error).message.split("\n")[0]}`, `没有成功：${(e as Error).message.split("\n")[0]}`));
    }
    setBusy(false);
  };

  const claimWithNumber = async () => {
    if (!/^\d{1,7}$/.test(number)) {
      setNote(L("Type the number of your TapeCode-Test1, as shown in your wallet.", "请填你的 TapeCode-Test1 编号（钱包里能看到）。"));
      return;
    }
    setBusy(true);
    setNote("");
    const r = await checkTest1(publicClient, terms, wallet as `0x${string}`, BigInt(number)).catch(() => "missing" as const);
    setBusy(false);
    if (r === "ok") return claim({ kind: "nft", collection: terms.test1, tokenId: BigInt(number), label: "test1" });
    play("error");
    setNote(
      r === "notYours"
        ? L(`TapeCode-Test1 #${number} belongs to another wallet.`, `TapeCode-Test1 #${number} 属于另一个钱包。`)
        : r === "used"
          ? L(`TapeCode-Test1 #${number} has already given its pin.`, `TapeCode-Test1 #${number} 已经领过徽章了。`)
          : L(`There is no TapeCode-Test1 #${number}.`, `没有 TapeCode-Test1 #${number}。`),
    );
  };

  const pinKey = `c2:${terms.outfit}`;
  const when = snapDate ? snapDate.toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long", day: "numeric" }) : `#${terms.snapshotBlock}`;
  return (
    <div className="holder-gift">
      <p className="label">{L("Holder pin", "持有人徽章")}</p>
      <div className="holder-gift-row">
        <OnPet pet={pet} id={pinKey} />
        <p className="small">
          {L(
            `A free pin for people who hold TapeOut things on X Layer: a TapeCode-Test1, a TapeOut Rig, or at least ${formatBem(terms.bemMin)} BEM or ${formatBem(terms.fabMin)} FAB on ${when} (a snapshot anyone can check). One per wallet, and each NFT gives it only once. It costs only gas.`,
            `送给在 X Layer 上持有 TapeOut 资产的人：一枚 TapeCode-Test1、一台 TapeOut 矿机，或在 ${when} 持有至少 ${formatBem(terms.bemMin)} BEM 或 ${formatBem(terms.fabMin)} FAB（快照，任何人都能核对）。每个钱包一枚，每个 NFT 只能领一次。只需要网络手续费。`,
          )}
        </p>
      </div>
      {claimed ? (
        <p className="small fashion-have">{L("You've claimed your holder pin. Wear it from the wardrobe.", "你已经领过持有人徽章了。去衣橱里穿上它吧。")}</p>
      ) : (
        <>
          {ways[0] && (
            <button type="button" className="btn primary" disabled={busy} onClick={() => (play("tap"), void claim(ways[0]!))}>
              {busy ? L("Claiming…", "领取中……") : L(`Claim it with ${WAY_NAME[ways[0].label].en}`, `凭${WAY_NAME[ways[0].label].zh}领取`)}
            </button>
          )}
          <form
            className="holder-gift-test1"
            onSubmit={(e) => {
              e.preventDefault();
              void claimWithNumber();
            }}
          >
            <label className="small">
              {L("Or claim with your TapeCode-Test1: its number", "或者凭你的 TapeCode-Test1 领取：编号")}
              <input inputMode="numeric" value={number} placeholder="#" onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 7))} />
            </label>
            <button type="submit" className="btn" disabled={busy || !number}>
              {L("Check and claim", "查看并领取")}
            </button>
          </form>
          {!ways.length && <p className="small">{L("This wallet holds no Rig and wasn't in the BEM or FAB snapshot; a TapeCode-Test1 number still works.", "这个钱包没有矿机，也不在 BEM 或 FAB 快照里；填 TapeCode-Test1 编号也可以。")}</p>}
        </>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
