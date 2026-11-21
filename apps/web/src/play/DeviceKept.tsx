/**
 * A pet kept on X Layer for free (H4): owned by a key this browser keeps. Said plainly where it lives and what would
 * lose it, with the two ways to keep it safe: move it to a wallet in one tap, or write the key down.
 */

import { useState } from "react";
import type { Pet } from "@lingxi/game";
import { useT } from "../i18n";
import { useChain } from "../game/chain";
import { exportSessionKey } from "../game/session";
import { play } from "../game/sound";

export function DeviceKept({ pet, lowGas }: { pet: Pet; lowGas: boolean }) {
  const t = useT();
  const { busy, moveToWallet } = useChain();
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="keeping device-kept">
      <p className="label">{t("free.title")}</p>
      <p className="small">{t("free.lives", { name: pet.name })}</p>
      <p className="small sp-warn">{t("free.risk", { name: pet.name })}</p>
      {lowGas && <p className="err">{t("free.gasUsed", { name: pet.name })}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), void moveToWallet(pet).then((ok) => ok && play("success")))}>
          {t("free.move")}
        </button>
        <button type="button" className="btn" onClick={() => (play("tap"), setKey(key ? null : exportSessionKey()), setCopied(false))} aria-expanded={!!key}>
          {t(key ? "free.hideKey" : "free.showKey")}
        </button>
      </div>
      {key && (
        <div className="device-key">
          <p className="small sp-warn">{t("free.keyWarn", { name: pet.name })}</p>
          <code className="mono">{key}</code>
          <button
            type="button"
            className="btn"
            onClick={() => {
              play("tap");
              void navigator.clipboard?.writeText(key).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {t(copied ? "free.copied" : "free.copy")}
          </button>
        </div>
      )}
    </div>
  );
}
