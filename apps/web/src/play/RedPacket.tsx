/**
 * Red packets carried by pets: fund one with USDT (held by the escrow contract,
 * never by us), send the link, and let friends open their shares. Every share is
 * decided by the LX-SEAL/1 circuit on TapeOut, and anyone can re-run it.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { drawPet } from "@lingxi/art";
import type { Pet } from "@lingxi/game";
import { type ClaimView, type PacketView } from "@lingxi/chain";
import { useLang } from "../i18n";
import { type PacketLink, decodePacketLink, packetsAvailable, readClaims, readPacket, usdt, usePackets } from "../game/packets";
import { deployment, publicClient } from "../game/chain";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import "./redpacket.css";

type Lang = "en" | "zh";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Fund and send a red packet from the Pet sheet. */
export function RedPacketPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { send, busy, error, sent, balance } = usePackets();
  const [amount, setAmount] = useState("8.88");
  const [count, setCount] = useState(4);
  const [lucky, setLucky] = useState(true);
  const [petsOnly, setPetsOnly] = useState(false);
  const [days, setDays] = useState(1);
  const [letter, setLetter] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (packetsAvailable()) void balance().then(setBal);
  }, [balance, link]);
  if (!packetsAvailable()) return null;
  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= 0.01 * count && count >= 1 && count <= 16;
  const tooMuch = bal !== null && valid && BigInt(Math.round(value * 1e6)) > bal;

  return (
    <div className="chainpanel rp-send">
      <p className="label">{lang === "zh" ? "红包" : "Red packet"}</p>
      <p className="small">
        {lang === "zh"
          ? `${pet.name}可以替你送一个红包。钱存在链上的托管合约里，不经过我们；没人领的部分到期后自动可退回给你。`
          : `${pet.name} can carry a red packet for you. The money sits in an escrow contract on chain, never with us; whatever nobody opens can go back to you when it expires.`}
      </p>
      {link ? (
        <>
          <div className="row">
            <input className="invite" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={lang === "zh" ? "红包链接" : "Red packet link"} />
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                try {
                  if (navigator.share) await navigator.share({ title: lang === "zh" ? `${pet.name}送来的红包` : `A red packet from ${pet.name}`, url: link });
                  else {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  }
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? (lang === "zh" ? "已复制" : "Copied") : lang === "zh" ? "发送" : "Share"}
            </button>
          </div>
          <p className="small">{lang === "zh" ? "任何拿到链接的人都能领一份，请只发给你想发的人。" : "Anyone with the link can open a share, so send it only to the people you mean."}</p>
          <button type="button" className="btn" onClick={() => setLink(null)}>
            {lang === "zh" ? "再发一个" : "Send another"}
          </button>
        </>
      ) : (
        <>
          <div className="rp-grid">
            <label>
              <span className="small">{lang === "zh" ? "总额（USDT）" : "Total (USDT)"}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label>
              <span className="small">{lang === "zh" ? "份数" : "Shares"}</span>
              <input type="number" min={1} max={16} value={count} onChange={(e) => setCount(Math.max(1, Math.min(16, Number(e.target.value) || 1)))} />
            </label>
            <label>
              <span className="small">{lang === "zh" ? "有效期" : "Lasts"}</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>{lang === "zh" ? "1 天" : "1 day"}</option>
                <option value={3}>{lang === "zh" ? "3 天" : "3 days"}</option>
                <option value={7}>{lang === "zh" ? "7 天" : "7 days"}</option>
              </select>
            </label>
          </div>
          <div className="rp-toggle" role="radiogroup" aria-label={lang === "zh" ? "怎么分" : "How to split"}>
            <button type="button" role="radio" aria-checked={lucky} className={lucky ? "on" : ""} onClick={() => setLucky(true)}>
              {lang === "zh" ? "拼手气" : "Lucky split"}
            </button>
            <button type="button" role="radio" aria-checked={!lucky} className={!lucky ? "on" : ""} onClick={() => setLucky(false)}>
              {lang === "zh" ? "平均分" : "Even split"}
            </button>
          </div>
          <label className="gift-check">
            <input type="checkbox" checked={petsOnly} onChange={(e) => setPetsOnly(e.target.checked)} />
            <span>{lang === "zh" ? "只有在链上养着灵犀宠物的人才能领" : "Only people with a Lingxi pet on chain can open it"}</span>
          </label>
          <label className="gift-letter">
            <span className="small">{lang === "zh" ? "祝福语" : "A message"}</span>
            <textarea rows={2} maxLength={200} value={letter} onChange={(e) => setLetter(e.target.value)} placeholder={lang === "zh" ? "新年快乐，恭喜发财！" : "Happy New Year!"} />
          </label>
          {bal !== null && <p className="small">{lang === "zh" ? `钱包里有 ${usdt(bal)} USDT` : `Your wallet holds ${usdt(bal)} USDT`}</p>}
          {tooMuch && <p className="small warn">{lang === "zh" ? "钱包里的 USDT 不够。" : "Not enough USDT in your wallet."}</p>}
          {error && <p className="err" role="alert">{lang === "zh" ? `没发出去：${error}` : `Didn't send: ${error}`}</p>}
          <button
            type="button"
            className="btn primary rp-go"
            disabled={!valid || tooMuch || !!busy}
            onClick={async () => {
              play("tap");
              const l = await send({ amount, count, lucky, petOwnersOnly: petsOnly, days, from: { name: pet.name, line: pet.line }, letter: letter.trim(), origin: `${location.origin}${location.pathname}` });
              if (l) {
                play("success");
                setLink(l);
              }
            }}
          >
            {busy ? (lang === "zh" ? "正在存入托管合约……" : "Putting it in escrow…") : lang === "zh" ? `塞进红包：${amount || 0} USDT` : `Fill the packet: ${amount || 0} USDT`}
          </button>
        </>
      )}
      {sent.length > 0 && <SentList />}
    </div>
  );
}

function SentList() {
  const lang = useLang((s) => s.lang) as Lang;
  const { sent, refund } = usePackets();
  const [views, setViews] = useState<Record<string, PacketView>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!deployment) return;
    let live = true;
    void Promise.all(sent.slice(0, 5).map(async (s) => [s.id, await readPacket(publicClient, deployment!, BigInt(s.id))] as const)).then((rows) => {
      if (live) setViews(Object.fromEntries(rows));
    });
    return () => {
      live = false;
    };
  }, [sent, tick]);
  return (
    <div className="rp-sent">
      <p className="small">{lang === "zh" ? "你发出的红包" : "Packets you sent"}</p>
      <ul>
        {sent.slice(0, 5).map((s) => {
          const v = views[s.id];
          const expired = v && Date.now() / 1000 >= v.expiry;
          return (
            <li key={s.id}>
              <b>#{s.id}</b> {s.total} USDT
              {v && (
                <span className="small">
                  {lang === "zh" ? ` · 已领 ${v.paid}/${v.count} · 剩 ${usdt(v.remaining)}` : ` · ${v.paid}/${v.count} opened · ${usdt(v.remaining)} left`}
                </span>
              )}
              {v && expired && v.remaining > 0n && (
                <button type="button" className="btn" onClick={async () => (await refund(s.id)) && (play("success"), setTick((t) => t + 1))}>
                  {lang === "zh" ? "退回剩余" : "Take back the rest"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A red packet arriving by link. */
export function PacketArrival() {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const open = usePackets((s) => s.open);
  const [link, setLink] = useState<PacketLink | null>(null);
  const [view, setView] = useState<PacketView | null>(null);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [stage, setStage] = useState<"idle" | "signing" | "claiming" | "luck" | "revealing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ amount: bigint; best: boolean } | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#packet=(lxp1\.[A-Za-z0-9_-]+)$/);
      if (!m || !packetsAvailable()) return;
      const l = decodePacketLink(m[1]!);
      if (!l) return setReason("broken");
      setLink(l);
      setStage("idle");
      setResult(null);
      void readPacket(publicClient, deployment!, BigInt(l.id)).then(setView, () => setReason("unknown"));
      void readClaims(publicClient, deployment!, BigInt(l.id)).then(setClaims, () => undefined);
    };
    read();
    // a link opened in a tab that already shows the game only changes the hash
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const carrier = useMemo(() => drawPet("gentle", "child", { expression: "proud" }), []);
  if (!link && !reason) return null;
  const close = () => {
    history.replaceState(null, "", location.pathname + location.search);
    setLink(null);
    setReason(null);
  };
  const reasonText: Record<string, [string, string]> = {
    broken: ["This red packet's link is damaged.", "这个红包的链接坏了。"],
    unknown: ["This red packet doesn't exist on chain.", "链上没有这个红包。"],
    allClaimed: ["Every share has been opened.", "红包已经被领完了。"],
    already: ["You've already opened this one.", "你已经领过这个红包了。"],
    expired: ["This red packet has expired.", "这个红包已经过期了。"],
    petsOnly: ["Only people with a Lingxi pet on chain can open this one.", "只有在链上养着灵犀宠物的人才能领这个红包。"],
    badKey: ["This link's key doesn't match the packet.", "这个链接的钥匙和红包对不上。"],
    noWallet: ["Opening a share needs a wallet (OKX Wallet or any browser wallet).", "领红包需要一个钱包（OKX 钱包或任意浏览器钱包）。"],
  };
  const text = (k: string) => reasonText[k]?.[lang === "zh" ? 1 : 0] ?? (lang === "zh" ? `没领成：${k}` : `Couldn't open it: ${k}`);
  const left = view ? view.count - view.paid : 0;
  const expired = view ? Date.now() / 1000 >= view.expiry : false;

  return (
    <div className="fam-modal rp-modal" role="dialog" aria-label={lang === "zh" ? "红包" : "Red packet"}>
      <motion.div className="fam-card rp-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {link && (
          <>
            <h3>{lang === "zh" ? `${link.from.name}送来一个红包` : `${link.from.name} brought you a red packet`}</h3>
            <div className="rp-stage">
              <motion.div className="gift-carrier" initial={reduce ? false : { x: -140 }} animate={{ x: 0 }} transition={{ duration: 1.1, ease: [0.23, 1, 0.32, 1] }}>
                <Sprite canvas={carrier} palette={PALETTE_OF[link.from.line]} scale={2.5} label={link.from.name} />
                <motion.span className="rp-envelope" aria-hidden="true" animate={reduce || stage !== "idle" ? {} : { rotate: [0, -5, 5, 0] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                  <span>{lang === "zh" ? "福" : "Fu"}</span>
                </motion.span>
              </motion.div>
            </div>
            {link.letter && <blockquote className="gift-letter-card">{link.letter}</blockquote>}
            {view && (
              <p className="small">
                {lang === "zh"
                  ? `${view.lucky ? "拼手气" : "平均分"} · 共 ${view.count} 份 · 还剩 ${left} 份 ${usdt(view.remaining)} USDT${view.petOwnersOnly ? " · 仅限灵犀宠物主人" : ""}`
                  : `${view.lucky ? "Lucky split" : "Even split"} · ${view.count} shares · ${left} left with ${usdt(view.remaining)} USDT${view.petOwnersOnly ? " · Lingxi pet owners only" : ""}`}
              </p>
            )}
            {result ? (
              <motion.div className="rp-result" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <b>{usdt(result.amount)} USDT</b>
                <span>{result.best ? (lang === "zh" ? "手气最佳！" : "Best luck!") : lang === "zh" ? "已存入你的钱包" : "In your wallet now"}</span>
              </motion.div>
            ) : stage === "error" ? (
              <p className="small warn">{text(reason ?? "")}</p>
            ) : (
              <button
                type="button"
                className="btn primary rp-open"
                disabled={stage !== "idle" || !view || left === 0 || expired}
                onClick={async () => {
                  play("pop");
                  const r = await open(link, setStage);
                  if (r.ok) {
                    play("success");
                    setResult({ amount: r.amount, best: r.best });
                    setStage("done");
                    void readClaims(publicClient, deployment!, BigInt(link.id)).then(setClaims);
                    void readPacket(publicClient, deployment!, BigInt(link.id)).then(setView);
                  } else {
                    play("error");
                    setReason(r.reason);
                    setStage("error");
                  }
                }}
              >
                {stage === "signing"
                  ? lang === "zh"
                    ? "签名中……"
                    : "Signing…"
                  : stage === "claiming"
                    ? lang === "zh"
                      ? "领取中……"
                      : "Opening…"
                    : stage === "luck"
                      ? lang === "zh"
                        ? "等下一个区块定手气……"
                        : "Waiting for the next block to decide your luck…"
                      : stage === "revealing"
                        ? lang === "zh"
                          ? "揭晓中……"
                          : "Revealing…"
                        : left === 0
                          ? lang === "zh"
                            ? "已领完"
                            : "All opened"
                          : expired
                            ? lang === "zh"
                              ? "已过期"
                              : "Expired"
                            : lang === "zh"
                              ? "开红包"
                              : "Open it"}
              </button>
            )}
            {claims.length > 0 && (
              <details className="rp-claims">
                <summary>{lang === "zh" ? `谁领了多少（${claims.length}）` : `Who got what (${claims.length})`}</summary>
                <ul>
                  {claims.map((c) => (
                    <li key={c.tx}>
                      <span>{short(c.claimer)}</span>
                      <b>{usdt(c.amount)}</b>
                      <em title={lang === "zh" ? "封印电路的输入和输出，可以用 eval 重算" : "The seal circuit's input and output; re-run them with eval"}>
                        seal {c.sealInput.toString(16).padStart(4, "0")}→{c.sealOutput.toString(16).padStart(2, "0")}
                      </em>
                    </li>
                  ))}
                </ul>
                <p className="small">
                  {lang === "zh"
                    ? `每一份都由 TapeOut 上的封印电路 #${deployment?.seal} 决定。拼手气的随机数来自领取之后的下一个区块的哈希，X Layer 的排序器理论上能影响它。`
                    : `Every share is decided by seal circuit #${deployment?.seal} on TapeOut. A lucky share's seed comes from the hash of the block after the claim; X Layer's sequencer could in principle influence it.`}
                </p>
              </details>
            )}
          </>
        )}
        {!link && reason && <p>{text(reason)}</p>}
        <button type="button" className="btn" onClick={close}>
          {lang === "zh" ? "关闭" : "Close"}
        </button>
      </motion.div>
    </div>
  );
}
