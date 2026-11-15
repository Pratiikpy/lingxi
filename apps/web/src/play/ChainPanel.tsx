/** The pet's on-chain twin: hatch it, save each day, and open the proof page. */

import type { Pet } from "@lingxi/game";
import { useT, type Key } from "../i18n";
import { deployment, explorerTx, lessonsKey, useChain } from "../game/chain";
import { play } from "../game/sound";
import { useGame } from "../game/store";

const ERR: Record<string, Key> = { noWallet: "chain.noWallet", noAccount: "chain.noWallet", alreadySaved: "chain.alreadySaved" };

export function ChainPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const { record, busy, error, keep, saveToday, updateMind, exportLog } = useChain();
  const say = useGame((s) => s.say);
  if (!deployment) return null;
  const busyText = busy === "connecting" ? t("chain.connecting") : busy === "hatching" ? t("chain.hatching") : busy === "saving" ? t("chain.saving") : busy === "taping" ? t("chain.taping") : null;
  const mindBehind = record && (record.brainKey ?? lessonsKey([])) !== lessonsKey(pet.lessons);
  const err = error ? t(ERR[error] ?? "chain.failed") : null;
  return (
    <div className="chainpanel onchain">
      <p className="label">{t("chain.title")}</p>
      {record ? (
        <>
          <div className="chain-row">
            <b>{t("chain.id", { id: record.petId })}</b>
            <span>{record.lastDay ? t("chain.saved", { n: record.lastDay }) : t("chain.never")}</span>
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), saveToday(pet, () => (play("success"), say("saved"))))}>
              {t("chain.save")}
            </button>
            <a className="btn" href={`verify.html#${record.petId}`}>
              {t("chain.verify")}
            </a>
            <a
              className="btn"
              download={`lingxi-pet-${record.petId}-log.json`}
              href={URL.createObjectURL(new Blob([exportLog(pet) ?? "{}"], { type: "application/json" }))}
            >
              {t("chain.download")}
            </a>
          </div>
          {mindBehind && (
            <div className="mind-behind">
              <p className="small">{t("chain.mindBehind", { name: pet.name })}</p>
              <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), updateMind(pet))}>
                {t("chain.updateMind")}
              </button>
            </div>
          )}
          {record.lastTx && explorerTx(record.lastTx) && (
            <a className="small" href={explorerTx(record.lastTx)!} target="_blank" rel="noopener noreferrer">
              {t("chain.tx")}
            </a>
          )}
        </>
      ) : pet.family ? (
        <p className="small">{t("chain.childOff", { name: pet.name })}</p>
      ) : (
        <>
          <p className="small">{t("chain.pitch", { name: pet.name })}</p>
          <p className="small">{t("chain.cost")}</p>
          <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), keep(pet))}>
            {t("chain.keep", { name: pet.name })}
          </button>
        </>
      )}
      {busyText && <p className="small thinking-dots" aria-live="polite">{busyText}</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}
