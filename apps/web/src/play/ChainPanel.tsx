/** The pet's on-chain twin: hatch it, save each day (by hand or automatically), let a friend sit it, and open the proof page. */

import { ruleSkillIds } from "@lingxi/game";
import { useEffect, useState } from "react";
import type { Pet } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { autoGasLow, autoStatus, deployment, explorerTx, mindKey, useChain } from "../game/chain";
import { relayAvailable } from "../game/api";
import { SelfTape } from "./SelfTape";
import { play } from "../game/sound";
import { NameClaim } from "./NameClaim";
import { useGame } from "../game/store";
import { SEND_LIMITS, TooBig, checkSize, sizeNote } from "../game/sendSize";
import { now } from "../game/gameClock";

const ERR: Record<string, Key> = {
  noWallet: "chain.noWallet",
  noAccount: "chain.noWallet",
  alreadySaved: "chain.alreadySaved",
  cannotReceive: "chain.cannotReceive",
  notThisPet: "chain.notThisPet",
  notKeeping: "chain.notKeeping",
  badAddress: "sit.badAddress",
  badDays: "sit.badDays",
  selfSitter: "sit.self",
  // what the relayer answers (services/api relayGate.ts and relayer.ts)
  busy: "relay.busy",
  budget: "relay.budget",
  notKeeper: "relay.notKeeper",
  unsigned: "relay.signature",
  expired: "relay.signature",
  replayed: "relay.signature",
  badSignature: "relay.signature",
  offline: "relay.offline",
};

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
  const auto = autoStatus(record, now());
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
  const mindBehind = record && (record.brainKey ?? mindKey([])) !== mindKey(pet.lessons, pet.instincts, pet.outside, ruleSkillIds(pet.growth));
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
            <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), saveToday(pet, () => (play("success"), say("saved"))))} data-hint="keep">
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
          <PublishDiary pet={pet} petId={record.petId} log={exportLog(pet)} />
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
            {record.sitter && record.sitter.until * 1000 > now() ? (
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
          <button type="button" className="btn primary" disabled={busy !== "idle"} onClick={() => (play("tap"), keep(pet))} data-hint="keep">
            {t("chain.keep", { name: pet.name })}
          </button>
        </>
      )}
      {busyText && <p className="small thinking-dots" aria-live="polite">{busyText}</p>}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

const DIARY_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");

/** Z1: put the diary on the pet's public page. The server keeps it only if it matches the log hash saved on chain. */
function PublishDiary({ pet, petId, log }: { pet: Pet; petId: string; log: string | null }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!DIARY_BASE || !log) return null;
  const words = (JSON.parse(log) as { words: number[] }).words.length;
  return (
    <div className="publish-diary">
      <p className="small">
        {L(
          `Put ${pet.name}'s diary on its public page, so anyone can read what its saved days were like. It is accepted only if it matches the log fingerprint saved on X Layer.`,
          `把${pet.name}的日记放到它的公开页面上，谁都能读到它保存过的日子。只有和 X Layer 上保存的日志指纹一致才会被接受。`,
        )}
      </p>
      <button
        type="button"
        className="btn"
        disabled={busy || !words}
        onClick={async () => {
          setBusy(true);
          setNote("");
          try {
            // measured before it leaves: a diary over the page's limit is never sent
            checkSize(log, SEND_LIMITS.logBodyBytes, { unit: "words", have: words, most: SEND_LIMITS.logWords });
            const r = await fetch(`${DIARY_BASE}/api/pets/${petId}/log`, { method: "POST", headers: { "content-type": "application/json" }, body: log, signal: AbortSignal.timeout(20000) });
            const j = (await r.json()) as { ok: boolean; beats?: number; reason?: string };
            play(j.ok ? "success" : "error");
            setNote(
              j.ok
                ? L(`Published: ${j.beats} moments, checked against the chain. Its page shows them now.`, `已发布：${j.beats} 个时刻，已对照链上核对。它的页面现在会显示。`)
                : j.reason === "mismatch"
                  ? L("It doesn't match what is saved on chain yet. Save today first, then publish.", "和链上保存的还对不上。请先保存今天，再发布。")
                  : j.reason === "older"
                    ? L("A longer diary is already on its page.", "它的页面上已经有更长的日记了。")
                    : L("That didn't go through. Try again later.", "没有成功，请稍后再试。"),
            );
          } catch (e) {
            play("error");
            setNote(
              e instanceof TooBig
                ? L(`The diary is too long to publish in one go ${sizeNote(e, lang)}. Nothing was sent.`, `日记太长，一次发布不了${sizeNote(e, lang)}。什么都没有发出去。`)
                : L("That didn't go through. Try again later.", "没有成功，请稍后再试。"),
            );
          }
          setBusy(false);
        }}
      >
        {busy ? L("Publishing…", "发布中……") : L("Publish its diary", "发布日记")}
      </button>
      {note && <p className="small" role="status">{note}</p>}
    </div>
  );
}
