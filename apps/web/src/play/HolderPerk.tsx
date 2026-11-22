/**
 * The holder perks, named on the hatch screen (H9): what TapeOut holders get, and a check of this wallet that reads its
 * balances only (nothing is signed, nothing is paid). A Test1 holder's eggs above turn gilded the moment the check
 * answers; the pin itself is claimed from the Pet tab once the pet has hatched.
 */
import { useState } from "react";
import { useLang } from "../i18n";
import { connectWallet } from "../game/chain";
import { readHoldings, useHoldings } from "../game/holders";
import { play } from "../game/sound";
import { errorText } from "../game/errorText";

export function HolderPerkNote() {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { held, set } = useHoldings();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const check = async () => {
    play("tap");
    setBusy(true);
    setNote("");
    try {
      const w = await connectWallet();
      set(await readHoldings(w.account!.address));
      play("success");
    } catch (e) {
      setNote(errorText(e) === "noWallet" ? L("No wallet found in this browser. Open Lingxi in the OKX Wallet app, or a browser with a wallet.", "这个浏览器里没有钱包。请在 OKX 钱包应用里打开灵犀，或用装了钱包的浏览器。") : L("Couldn't read the wallet just now.", "暂时读不到这个钱包。"));
    }
    setBusy(false);
  };

  const gives = held
    ? [
        held.test1 && L("your eggs hatch from a gilded shell (you hold a TapeCode-Test1)", "你的蛋从镀金蛋壳里孵出来（你持有 TapeCode-Test1）"),
        held.rig && L("your home can wear the rig bay (you hold a TapeOut Rig)", "你的家能换上矿机间（你持有 TapeOut 矿机）"),
        (held.test1 || held.rig) && L("a free holder pin, to claim in the Pet tab once your pet has hatched", "一枚免费的持有人徽章，宠物孵出来后在宠物页领取"),
        held.bem && L("the BEM holder mark", "BEM 持有人标记"),
        held.fab && L("the FAB holder mark", "FAB 持有人标记"),
      ].filter((x): x is string => !!x)
    : [];

  return (
    <section className="hatch-perk" aria-labelledby="hatch-perk-h">
      <p id="hatch-perk-h" className="hatch-perk-h">
        {L("Hold TapeOut?", "持有 TapeOut？")}
      </p>
      {!held ? (
        <p className="hatch-perk-p">
          {L(
            "A TapeCode-Test1 gilds your eggs, and Test1, Rig, BEM and FAB holders get a free pin for their pet. Checking reads your wallet's balances only: nothing to sign, nothing to pay.",
            "持有 TapeCode-Test1，你的蛋就是镀金的；Test1、矿机、BEM 和 FAB 持有人还能给宠物领一枚免费徽章。查看只读钱包余额：不用签名，不花钱。",
          )}
        </p>
      ) : gives.length ? (
        <ul className="hatch-perk-list" aria-label={L("This wallet gives", "这个钱包能得到")}>
          {gives.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      ) : (
        <p className="hatch-perk-p">
          {L(
            "This wallet holds no TapeCode-Test1, Rig, BEM or FAB on X Layer, so there is nothing to claim; nothing changed and nothing was spent. A wallet that held at least 0.1 BEM or 10 FAB at block 76,052,000 can still claim the pin in the Pet tab.",
            "这个钱包在 X Layer 上没有 TapeCode-Test1、矿机、BEM 或 FAB，所以没有可领的东西；什么都没变，也没花钱。在第 76,052,000 个区块时持有至少 0.1 BEM 或 10 FAB 的钱包，仍可在宠物页领取徽章。",
          )}
        </p>
      )}
      <button type="button" className="hatch-perk-btn" disabled={busy} onClick={() => void check()}>
        {busy ? L("Checking…", "查看中……") : held ? L("Check again", "再查一次") : L("Check my wallet", "查看我的钱包")}
      </button>
      {note && (
        <p className="hatch-perk-p" role="alert">
          {note}
        </p>
      )}
    </section>
  );
}
