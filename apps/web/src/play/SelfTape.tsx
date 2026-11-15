/**
 * Tape out the pet's brain with your own wallet (PRD F34): the full cost first,
 * in every currency it takes and against what the wallet holds; one confirm;
 * then each step ticks off, ending with a check that the circuit on chain is
 * byte for byte the one compiled here.
 */

import { useState } from "react";
import { formatEther } from "viem";
import type { TapeQuote, TapeStep } from "@lingxi/chain";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import { useChain } from "../game/chain";
import { play } from "../game/sound";

type Lang = "en" | "zh";
type Step = TapeStep | "setBrain";

const STEP_TEXT: Record<Step, { en: string; zh: string }> = {
  approve: { en: "Approve TapeOut's fee in BEM", zh: "授权支付 TapeOut 的 BEM 手续费" },
  mintNand: { en: "Mint the NAND gates", zh: "铸造与非门" },
  mintLatch: { en: "Mint the memory latches", zh: "铸造记忆锁存器" },
  tapeout: { en: "Tape out the circuit", zh: "流片电路" },
  verify: { en: "Check the chain holds exactly this circuit", zh: "核对链上电路与这里一致" },
  setBrain: { en: "Move the pet onto its new brain", zh: "让宠物换上新大脑" },
};

const fmt = (wei: bigint) => {
  const v = Number(formatEther(wei));
  return v === 0 ? "0" : v < 0.0001 ? "<0.0001" : v.toFixed(v < 0.01 ? 5 : 4);
};

export function SelfTape({ pet, behind }: { pet: Pet; behind: boolean }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { busy, quoteSelf, selfTape } = useChain();
  const [quote, setQuote] = useState<TapeQuote | null>(null);
  const [done, setDone] = useState<Step[]>([]);
  const [current, setCurrent] = useState<Step | null>(null);
  const [result, setResult] = useState<"ok" | "failed" | null>(null);

  if (!quote && !behind) return null;
  if (!quote)
    return (
      <button
        type="button"
        className="btn"
        disabled={busy !== "idle"}
        onClick={async () => {
          play("tap");
          setResult(null);
          setQuote(await quoteSelf(pet));
        }}
      >
        {lang === "zh" ? "用自己的钱包流片（先看费用）" : "Tape it out with my own wallet (see the cost first)"}
      </button>
    );

  const steps: Step[] = [...(quote.bemNeeded > 0n ? (["approve"] as const) : []), ...(quote.mint.nand > 0n ? (["mintNand"] as const) : []), ...(quote.mint.latch > 0n ? (["mintLatch"] as const) : []), "tapeout", "verify", "setBrain"];
  const running = current !== null && result === null;
  return (
    <div className="selftape">
      <p className="label">{lang === "zh" ? "流片费用" : "What it costs"}</p>
      <dl className="st-rows">
        <dt>{lang === "zh" ? "电路" : "Circuit"}</dt>
        <dd>{lang === "zh" ? `${quote.nands} 个与非门 · ${quote.latches} 个锁存器` : `${quote.nands} NAND gates · ${quote.latches} latches`}</dd>
        <dt>{lang === "zh" ? "要铸造的门" : "Gates to mint"}</dt>
        <dd>{`${quote.mint.nand} + ${quote.mint.latch}`}</dd>
        <dt>OKB</dt>
        <dd>
          {fmt(quote.okbTotal)} {lang === "zh" ? `（含约 ${fmt(quote.gasEstimate)} 网络费）` : `(including about ${fmt(quote.gasEstimate)} in network fees)`}
          <span className={quote.okbBalance >= quote.okbTotal ? "st-ok" : "st-short"}> · {lang === "zh" ? `你有 ${fmt(quote.okbBalance)}` : `you have ${fmt(quote.okbBalance)}`}</span>
        </dd>
        {quote.bemNeeded > 0n && (
          <>
            <dt>BEM</dt>
            <dd>
              {fmt(quote.bemNeeded)} {lang === "zh" ? "（TapeOut 协议费）" : "(TapeOut's protocol fee)"}
              <span className={quote.bemBalance >= quote.bemNeeded ? "st-ok" : "st-short"}> · {lang === "zh" ? `你有 ${fmt(quote.bemBalance)}` : `you have ${fmt(quote.bemBalance)}`}</span>
            </dd>
          </>
        )}
      </dl>
      <p className="small">
        {lang === "zh"
          ? `确认一次后，钱包会请你签 ${quote.signatures + 1} 次（最后一次是给宠物换大脑）。`
          : `After one confirm, your wallet asks you to sign ${quote.signatures + 1} times (the last moves the pet onto the new brain).`}
      </p>
      {!quote.enough && (
        <p className="st-short" role="alert">
          {quote.bemBalance < quote.bemNeeded
            ? lang === "zh"
              ? "钱包里的 BEM 不够付 TapeOut 的手续费。可以先换一些 BEM，或者在网页版用免费流片。"
              : "The wallet doesn't hold enough BEM for TapeOut's fee. Get some BEM first, or use the free tape-out on the web version."
            : lang === "zh"
              ? "钱包里的 OKB 不够。"
              : "The wallet doesn't hold enough OKB."}
        </p>
      )}
      <ol className="st-steps">
        {steps.map((s) => (
          <li key={s} className={done.includes(s) ? "done" : current === s && running ? "now" : ""}>
            {done.includes(s) ? "✓" : current === s && running ? "…" : "○"} {STEP_TEXT[s][lang]}
          </li>
        ))}
      </ol>
      {result === "ok" && <p className="st-ok st-result">{lang === "zh" ? `成功！${pet.name}现在用的是链上这颗新大脑。` : `Done. ${pet.name} now runs on its new brain on chain.`}</p>}
      {result === "failed" && <p className="st-short st-result">{lang === "zh" ? "中途停下了，没有扣到的费用不会扣。可以再试一次。" : "It stopped partway; nothing further was spent. You can try again."}</p>}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={!quote.enough || running || result === "ok" || busy !== "idle"}
          onClick={async () => {
            play("tap");
            setDone([]);
            setResult(null);
            let last: Step | null = null;
            const ok = await selfTape(pet, quote, (s) => {
              // the step before this one has finished
              const prev = last;
              if (prev) setDone((d) => [...d, prev]);
              last = s;
              setCurrent(s);
            });
            const final = last;
            if (ok && final) setDone((d) => [...d, final]);
            setResult(ok ? "ok" : "failed");
            play(ok ? "success" : "error");
          }}
        >
          {lang === "zh" ? "确认流片" : "Confirm tape-out"}
        </button>
        <button type="button" className="btn" disabled={running} onClick={() => (setQuote(null), setDone([]), setCurrent(null), setResult(null))}>
          {lang === "zh" ? "关闭" : "Close"}
        </button>
      </div>
    </div>
  );
}
