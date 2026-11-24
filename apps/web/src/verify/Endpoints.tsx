/**
 * Where this page's proofs come from: which hosts answered, how many reads each, and a box for the judge's own X Layer
 * RPC, which is then asked before any of ours. If Lingxi's server ever had to answer, it says so in plain words.
 */

import { useState } from "react";
import { checkOwnRpc, endpoints, useProofRpc } from "../game/proofRpc";

const T = {
  en: {
    title: "Where these proofs come from",
    lede: "Every read of X Layer on this page comes from your browser: your own RPC first if you add one, then X Layer's public RPCs, and Lingxi's server only if all of those fail. Three things come from Lingxi's server instead: Sourcify's verdicts on the contracts (each row links to Sourcify itself), a pet's history (each row links to its transaction on X Layer) and its published diary (checked against X Layer before it is shown).",
    // the on-chain copy has no server: its own wording (A127)
    ledeOnChain: "Every read of X Layer on this page comes from your browser: your own RPC first if you add one, then X Layer's public RPCs. This copy of the page is served from X Layer itself and has no server to fall back on. Sourcify's verdicts on the contracts are asked of Sourcify directly; a pet's history and its published diary come from Lingxi's indexer (each history row links to its transaction on X Layer, and the diary is checked against X Layer before it is shown).",
    asked: "Asked, in order",
    answered: "Answered so far",
    none: "nothing yet",
    fallback: "Lingxi's server answered {n} of these reads because the public endpoints did not. Add your own RPC above to take it out entirely.",
    noFallback: "Lingxi's server has answered none of them.",
    mine: "Your own X Layer RPC",
    use: "Use it",
    clear: "Stop using it",
    checking: "Checking…",
    bad: { address: "That is not an https address.", unreachable: "It did not answer.", chain: "It answered, but not for X Layer (chain 196)." },
    yours: "yours",
    server: "Lingxi's server, only if all else fails",
  },
  zh: {
    title: "这些证明从哪里来",
    lede: "本页对 X Layer 的每一次读取都来自你的浏览器：如果你填了自己的 RPC，会先问它，再问 X Layer 的公共 RPC，只有它们全部失败时才会问灵犀的服务器。有三样东西来自灵犀的服务器：Sourcify 对合约的验证结果（每一行都链接到 Sourcify 本身）、宠物的经历（每一行都链接到它在 X Layer 上的交易），以及发布的日记（显示之前先对照 X Layer 核对）。",
    ledeOnChain: "本页对 X Layer 的每一次读取都来自你的浏览器：如果你填了自己的 RPC，会先问它，再问 X Layer 的公共 RPC。这一份页面本身就存放在 X Layer 上，没有可以退回去问的服务器。合约的 Sourcify 验证结果直接询问 Sourcify；宠物的经历和发布的日记来自灵犀的索引服务（每一行经历都链接到它在 X Layer 上的交易，日记在显示之前先对照 X Layer 核对）。",
    asked: "询问顺序",
    answered: "目前的回答",
    none: "还没有",
    fallback: "其中 {n} 次读取是灵犀的服务器回答的，因为公共节点没有回应。在上面填入你自己的 RPC 就能完全不经过它。",
    noFallback: "灵犀的服务器一次也没有回答。",
    mine: "你自己的 X Layer RPC",
    use: "使用",
    clear: "不再使用",
    checking: "检查中……",
    bad: { address: "这不是 https 地址。", unreachable: "它没有回应。", chain: "它回应了，但不是 X Layer（链 196）。" },
    yours: "你的",
    server: "灵犀的服务器，仅在其他都失败时",
  },
};

/** What the page says of where its proofs come from: the live site has a server to fall back on; the on-chain copy has none (A127). */
export function sourcesLede(lang: "en" | "zh", hasServer: boolean): string {
  return hasServer ? T[lang].lede : T[lang].ledeOnChain;
}

export function EndpointPanel({ lang }: { lang: "en" | "zh" }) {
  const t = T[lang];
  const { mine, hosts, fallback, setMine } = useProofRpc();
  const [draft, setDraft] = useState(mine ?? "");
  const [state, setState] = useState<"idle" | "checking" | keyof (typeof T)["en"]["bad"]>("idle");
  const ends = endpoints();
  const order = [...(ends.mine ? [{ host: new URL(ends.mine).host, note: t.yours }] : []), ...ends.publicRpcs.map((u) => ({ host: new URL(u).host, note: "" })), ...(ends.fallback ? [{ host: new URL(ends.fallback).host, note: t.server }] : [])];
  const answered = Object.entries(hosts).sort((a, b) => b[1] - a[1]);

  const use = async () => {
    setState("checking");
    const r = await checkOwnRpc(draft);
    if (!r.ok) return setState(r.reason);
    setMine(new URL(draft.trim()).toString());
    setState("idle");
  };

  return (
    <section className="v-card v-endpoints" aria-labelledby="endpoints-h">
      <h2 id="endpoints-h">{t.title}</h2>
      <p className="v-note" data-testid="sources-lede">{sourcesLede(lang, ends.fallback !== null && ends.fallback !== "")}</p>
      <dl>
        <dt>{t.asked}</dt>
        <dd>
          <ol className="v-hosts">
            {order.map((o) => (
              <li key={o.host} className="mono">
                {o.host}
                {o.note && <span className="v-note"> · {o.note}</span>}
              </li>
            ))}
          </ol>
        </dd>
        <dt>{t.answered}</dt>
        <dd className="mono" data-testid="answered">
          {answered.length ? answered.map(([h, n]) => `${h} ${n.toLocaleString()}`).join(" · ") : t.none}
        </dd>
      </dl>
      {/* the on-chain copy has no server to count answers from (A127) */}
      {ends.fallback ? (
        <p className={fallback ? "v-bad" : "v-note"} data-testid="fallback">
          {fallback ? t.fallback.replace("{n}", fallback.toLocaleString()) : t.noFallback}
        </p>
      ) : null}
      <form
        className="v-form"
        onSubmit={(e) => {
          e.preventDefault();
          void use();
        }}
      >
        <label htmlFor="own-rpc">{t.mine}</label>
        <input id="own-rpc" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={state === "checking" || !draft.trim()}>
          {state === "checking" ? t.checking : t.use}
        </button>
        {mine && (
          <button
            type="button"
            className="v-link"
            onClick={() => {
              setMine(null);
              setDraft("");
            }}
          >
            {t.clear}
          </button>
        )}
      </form>
      {state !== "idle" && state !== "checking" && <p className="v-bad">{t.bad[state]}</p>}
    </section>
  );
}
