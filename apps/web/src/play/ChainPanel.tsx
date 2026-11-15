/** The pet's on-chain twin: hatch it, save each day (by hand or automatically), let a friend sit it, and open the proof page. */

import { useEffect, useState } from "react";
import type { Pet } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { autoGasLow, autoStatus, deployment, explorerTx, mindKey, useChain } from "../game/chain";
import { relayAvailable } from "../game/api";
import { SelfTape } from "./SelfTape";
import { play } from "../game/sound";
import { NameClaim } from "./NameClaim";
import { useGame } from "../game/store";

const ERR: Record<string, Key> = { noWallet: "chain.noWallet", noAccount: "chain.noWallet", alreadySaved: "chain.alreadySaved", badAddress: "sit.badAddress", badDays: "sit.badDays", selfSitter: "sit.self" };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const dateOf = (sec: number, lang: string) => new Date(sec * 1000).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { month: "short", day: "numeric" });

export function ChainPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { record, busy, error, keep, saveToday, updateMind, exportLog, enableAuto, endSitting, sitWith } = useChain();
  const say = useGame((s) => s.say);
  const [friend, setFriend] = useState("");
  const [days, setDays] = useState(3);
  const [lowGas, setLowGas] = useState(false);
  const auto = autoStatus(record, Date.now());
  useEffect(() => {
    if (auto === "off") return;
    let live = true;
    autoGasLow().then((low) => live && setLowGas(low), () => {});
    return () => {
      live = false;
    };
  }, [auto, record?.lastTx]);
  if (!deployment) return null;
  const busyText = busy === "connecting" ? t("chain.connecting") : busy === "hatching" ? t("chain.hatching") : busy === "saving" ? t("chain.saving") : busy === "taping" ? t("chain.taping") : busy === "auto" ? t("auto.saving") : null;
  const mindBehind = record && (record.brainKey ?? mindKey([])) !== mindKey(pet.lessons, pet.instincts);
  const err = error ? t(ERR[error] ?? "chain.failed") : null;
  // a friend's pet: the sitter may save its day (PetRegistry lets the named sitter), and nothing else here
  if (pet.sitting || pet.away)
    return (
      <div className="chainpanel onchain">
        <p className="label">{t("chain.title")}</p>
        {record && pet.sitting ? (
          <>
            <div className="chain-row">
              <b>{t("chain.id", { id: record.petId })}</b>
              <span>{record.lastDay ? t("chain.saved", { n: record.lastDay }) : t("chain.never")}</span>
            </div>
            <p className="small">{lang === "zh" ? "如果主人把你的钱包设为了照看人，你可以帮它存今天的档。" : "If its owner named your wallet as its sitter on chain, you can save its day."}</p>
            <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), saveToday(pet, () => (play("success"), say("saved"))))}>
              {t("chain.save")}
            </button>
            {busyText && <p className="small">{busyText}</p>}
            {err && <p className="small sp-warn">{err}</p>}
          </>
        ) : (
          <p className="small">{pet.away ? (lang === "zh" ? "它不在家，回来后再存档。" : "It is away; saving waits until it is home.") : lang === "zh" ? "它还不在链上，这要由它的主人来做。" : "It isn't on chain yet; that is for its owner to do."}</p>
        )}
      </div>
    );
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
          <NameClaim pet={pet} record={record} />
          <div className="keeping">
            <p className="label">{t("auto.title")}</p>
            {auto === "off" ? (
              <>
                <p className="small">{t("auto.pitch", { name: pet.name })}</p>
                <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), enableAuto(pet))}>
                  {t("auto.on")}
                </button>
              </>
            ) : (
              <>
                <p className="small">{t(auto === "ending" ? "auto.ending" : "auto.until", { date: dateOf(record.autoUntil!, lang) })}</p>
                {lowGas && <p className="err">{t("auto.lowGas")}</p>}
                <div className="row">
                  {(auto === "ending" || lowGas) && (
                    <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), enableAuto(pet))}>
                      {t("auto.renew")}
                    </button>
                  )}
                  <button type="button" className="btn" disabled={busy !== "idle"} onClick={() => (play("tap"), endSitting(pet))}>
                    {t("auto.off")}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="keeping">
            <p className="label">{t("sit.title")}</p>
            {record.sitter && record.sitter.until * 1000 > Date.now() ? (
              <>
                <p className="small">{t("sit.now", { who: short(record.sitter.who), date: dateOf(record.sitter.until, lang) })}</p>
                <button type="button" className="btn" disabled={busy !== "idle"} onClick={() => (play("tap"), endSitting(pet))}>
                  {t("sit.end")}
                </button>
              </>
            ) : (
              <form
                className="sit-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  play("tap");
                  void sitWith(pet, friend.trim(), days).then((ok) => ok && (setFriend(""), play("success")));
                }}
              >
                <p className="small">{t("sit.pitch", { name: pet.name })}</p>
                <label className="sr" htmlFor="sit-who">
                  {t("sit.who")}
                </label>
                <input id="sit-who" className="input mono" placeholder="0x…" value={friend} onChange={(e) => setFriend(e.target.value)} autoComplete="off" spellCheck={false} />
                <div className="row">
                  <label className="small" htmlFor="sit-days">
                    {t("sit.days")}
                  </label>
                  <select id="sit-days" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {[1, 3, 7, 14, 30].map((d) => (
                      <option key={d} value={d}>
                        {t("sit.dayN", { n: d })}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn primary" disabled={busy !== "idle" || !friend.trim()}>
                    {t("sit.go")}
                  </button>
                </div>
                {auto !== "off" && <p className="small">{t("sit.pausesAuto")}</p>}
              </form>
            )}
          </div>
          {mindBehind && (
            <div className="mind-behind">
              <p className="small">{t("chain.mindBehind", { name: pet.name })}</p>
              {relayAvailable() && (
                <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), updateMind(pet))}>
                  {t("chain.updateMind")}
                </button>
              )}
            </div>
          )}
          {/* stays mounted after it succeeds (when the mind is no longer behind) so its result can be read */}
          {!pet.family && <SelfTape pet={pet} behind={!!mindBehind} />}
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
