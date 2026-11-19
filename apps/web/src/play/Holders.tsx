/** Holder cosmetics (PRD X2): connect a wallet, see what it holds, and the cosmetic things that unlocks. */

import { useState } from "react";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import { connectWallet } from "../game/chain";
import { HOLDINGS, readHoldings, useHoldings } from "../game/holders";
import { play } from "../game/sound";
import { Icon, type IconName } from "./icons";
import { HolderGiftPanel } from "./HolderGift";
import { errorText } from "../game/errorText";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const MARKS: Array<{ key: "rig" | "bem" | "fab" | "test1"; icon: IconName; name: { en: string; zh: string }; gives: { en: string; zh: string }; contract?: string }> = [
  { key: "rig", icon: "home", name: { en: "Rig holder", zh: "矿机持有人" }, gives: { en: "a rig-bay skin for your home", zh: "家里的矿机间外观" }, contract: HOLDINGS.rig },
  { key: "bem", icon: "star", name: { en: "BEM holder", zh: "BEM 持有人" }, gives: { en: "the BEM mark", zh: "BEM 标记" }, contract: HOLDINGS.bem },
  { key: "fab", icon: "star", name: { en: "FAB holder", zh: "FAB 持有人" }, gives: { en: "the FAB mark", zh: "FAB 标记" }, contract: HOLDINGS.fab },
  { key: "test1", icon: "gift", name: { en: "TapeCode Test1 holder", zh: "TapeCode Test1 持有人" }, gives: { en: "a gilded egg shell when you hatch", zh: "孵化时的镀金蛋壳" } },
];

export function HoldersPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { held, skinOn, set, setSkin, clear } = useHoldings();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const check = async () => {
    setBusy(true);
    setNote("");
    try {
      const w = await connectWallet();
      set(await readHoldings(w.account!.address));
      play("success");
    } catch (e) {
      setNote(
        errorText(e) === "noWallet"
          ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。")
          : L("Couldn't read the wallet's holdings just now.", "暂时读不到这个钱包的持有情况。"),
      );
    }
    setBusy(false);
  };

  return (
    <div className="chainpanel holders">
      <p className="label">{L("Holder cosmetics", "持有人外观")}</p>
      <p className="small">
        {L(
          "Holders of TapeOut and Fab X tokens on X Layer get a few looks. Cosmetic only: nothing here changes how a pet thinks, fights or earns.",
          "在 X Layer 上持有 TapeOut 和 Fab X 代币的玩家，会得到几样外观。只是外观：不会改变宠物怎么想、怎么切磋、赚多少。",
        )}
      </p>
      <ul className="holder-marks">
        {MARKS.map((m) => {
          const has = held ? held[m.key] : null;
          return (
            <li key={m.key} className={`holder-mark${has ? " is-on" : ""}`}>
              <Icon name={m.icon} size={18} />
              <span>
                <b>{m.name[lang]}</b>
                <span className="small">
                  {has ? L(`Unlocked: ${m.gives.en}`, `已解锁：${m.gives.zh}`) : L(`Gives ${m.gives.en}`, `可得：${m.gives.zh}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {held?.rig && (
        <label className="sp-cheer">
          <input type="checkbox" checked={skinOn} onChange={(e) => (play("tap"), setSkin(e.target.checked))} />
          <span>{L("Use the rig-bay skin at home", "家里用矿机间外观")}</span>
        </label>
      )}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => (play("tap"), void check())}>
          {busy ? L("Checking…", "查看中……") : held ? L("Check again", "再查一次") : L("Connect a wallet to check", "连接钱包查看")}
        </button>
        {held && (
          <button type="button" className="btn" onClick={() => (play("tap"), clear())}>
            {L("Forget this wallet", "忘掉这个钱包")}
          </button>
        )}
      </div>
      {held && <HolderGiftPanel pet={pet} wallet={held.wallet} />}
      {held && <p className="small">{L(`Checked ${short(held.wallet)} on X Layer, ${new Date(held.at).toLocaleString("en")}.`, `已在 X Layer 上查看 ${short(held.wallet)}，${new Date(held.at).toLocaleString("zh-CN")}。`)}</p>}
      {note && (
        <p className="small sp-warn" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}
