/**
 * Open and verified contracts (plan 4.13): every Lingxi contract on X Layer, what it holds, its address on the
 * explorer, and its Solidity source on Sourcify. The page asks Sourcify each time it opens, so the state shown is
 * Sourcify's own answer for the bytecode on chain, never a claim written into the page.
 */

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Deployment } from "@lingxi/chain";
import { deployment } from "../game/chain";
import { type SourceState, sourcifyPage, sourcifyState } from "../game/sourcify";

type Key = "registry" | "breeder" | "adoptionCentre" | "outfitMarketV2" | "itemShop" | "extras" | "holderGift" | "look" | "redPacket" | "outfitMarket" | "breederFree";

const CONTRACTS: Array<{ key: Key; name: string; about: { en: string; zh: string } }> = [
  { key: "registry", name: "PetRegistry", about: { en: "pets, daily saves, sitters and parents", zh: "宠物、每日存档、代养和父母" } },
  { key: "breeder", name: "BreederV2", about: { en: "children of two pets; 0.1 BEM burned", zh: "两只宠物的孩子；销毁 0.1 BEM" } },
  { key: "adoptionCentre", name: "AdoptionCentre", about: { en: "young bred pets offered for adoption; 3% burned", zh: "可领养的小宝宝；销毁 3%" } },
  { key: "outfitMarketV2", name: "OutfitMarketV2", about: { en: "player outfits and on-chain items for BEM; fees burned", zh: "玩家时装和链上道具，用 BEM 买卖；手续费销毁" } },
  { key: "itemShop", name: "ItemShop", about: { en: "decorations and limited outfits for BEM, the whole price burned", zh: "用 BEM 买摆设和限量服饰，全价销毁" } },
  { key: "extras", name: "Extras", about: { en: "room space, saved looks and name colours; every price burned", zh: "房间空间、存搭配和名字颜色；全价销毁" } },
  { key: "holderGift", name: "HolderGift", about: { en: "the free holder outfit: Test1 and Rig by the token held, BEM and FAB by a snapshot at a fixed block", zh: "持有人免费外观：Test1 和矿机按持有的代币，BEM 和 FAB 按固定区块的快照" } },
  { key: "look", name: "PetLook", about: { en: "each pet's picture and name, drawn on chain", zh: "每只宠物的画像和名字，在链上绘制" } },
  { key: "redPacket", name: "RedPacket", about: { en: "gift packets sealed by a circuit", zh: "由电路封口的红包" } },
  { key: "outfitMarket", name: "OutfitMarket", about: { en: "the first market, priced in OKB", zh: "最早的时装市场，用 OKB 定价" } },
  { key: "breederFree", name: "Breeder", about: { en: "the first breeder, before the BEM fee", zh: "最早的繁育合约，收 BEM 费之前" } },
];

const WORD: Record<SourceState, { en: string; zh: string }> = {
  exact: { en: "✓ source verified", zh: "✓ 源码已验证" },
  partial: { en: "~ partial match", zh: "~ 部分匹配" },
  none: { en: "✗ not verified", zh: "✗ 未验证" },
  unreachable: { en: "? Sourcify unreachable", zh: "? 连不上 Sourcify" },
};

/** The live site asks Sourcify through its own server (A71); the on-chain copy, which has none, asks it directly. */
const VIA_SERVER = Boolean((import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : ""));

export function ContractTable({ lang }: { lang: "en" | "zh" }) {
  const d = deployment as Deployment | undefined;
  const rows = CONTRACTS.flatMap((c) => {
    const address = d?.[c.key] as Address | undefined;
    return address ? [{ ...c, address }] : [];
  });
  const [states, setStates] = useState<Record<string, SourceState>>({});
  const addresses = rows.map((r) => r.address).join(",");
  useEffect(() => {
    if (!addresses) return;
    const ctl = new AbortController();
    for (const a of addresses.split(",") as Address[]) {
      void sourcifyState(a, ctl.signal).then((s) => {
        if (!ctl.signal.aborted) setStates((prev) => ({ ...prev, [a]: s }));
      });
    }
    return () => ctl.abort();
  }, [addresses]);
  const verified = rows.filter((r) => states[r.address] === "exact").length;
  const checked = rows.filter((r) => states[r.address]).length;
  // a contract Sourcify could not be asked about is not counted as unverified: it is said apart (A71)
  const unreached = rows.filter((r) => states[r.address] === "unreachable").length;
  return (
    <section id="contracts" className="v-card v-proof-table" aria-labelledby="contracts-h">
      <h2 id="contracts-h">{lang === "zh" ? "合约与源码" : "Contracts and their source"}</h2>
      <p className="v-note">
        {lang === "zh"
          ? `灵犀在 X Layer 上的每个合约都把 Solidity 源码公开在 Sourcify：任何人都能看到链上运行的代码就是这份源码。这一栏每次打开都会询问 Sourcify${VIA_SERVER ? "（经由灵犀的服务器转问，每一行都链接到 Sourcify 自己的页面）" : ""}。`
          : `Every Lingxi contract on X Layer has its Solidity source published on Sourcify, so anyone can see that the code running on chain is this source. This column asks Sourcify each time the page opens${VIA_SERVER ? " (through Lingxi's server; each row links to Sourcify's own page)" : ""}.`}
      </p>
      {rows.length === 0 ? (
        <p className="v-note">{lang === "zh" ? "这个版本还没有连接到链上合约。" : "This build is not connected to deployed contracts."}</p>
      ) : (
        <>
          <p className="v-note" role="status">
            {checked < rows.length
              ? lang === "zh"
                ? "正在询问 Sourcify……"
                : "Asking Sourcify…"
              : unreached === rows.length
                ? lang === "zh"
                  ? "现在连不上 Sourcify，所以暂时核对不了这些合约的源码。过一会儿再打开这一页。"
                  : "Sourcify can't be reached just now, so the contracts' source can't be checked. Open this page again in a little while."
                : lang === "zh"
                  ? `${rows.length} 个合约中 ${verified} 个源码完全匹配（创建码和运行码都一致）${unreached ? `；${unreached} 个暂时连不上 Sourcify，没能核对` : ""}。`
                  : `${verified} of ${rows.length} contracts are an exact match (both creation and runtime bytecode)${unreached ? `; ${unreached} could not be checked, as Sourcify could not be reached` : ""}.`}
          </p>
          <div className="v-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{lang === "zh" ? "合约" : "Contract"}</th>
                  <th>{lang === "zh" ? "地址" : "Address"}</th>
                  <th>{lang === "zh" ? "源码" : "Source"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = states[r.address];
                  return (
                    <tr key={r.key}>
                      <td>
                        <span className="mono">{r.name}</span>
                        <span className="v-rule-about">{r.about[lang]}</span>
                      </td>
                      <td>
                        <a className="mono" href={`https://www.oklink.com/xlayer/address/${r.address}`} target="_blank" rel="noopener noreferrer">
                          {r.address.slice(0, 6)}…{r.address.slice(-4)}
                        </a>
                      </td>
                      <td className={s === "exact" ? "v-ok" : s === "none" || s === "partial" ? "v-bad" : ""}>
                        {s ? (
                          <a href={sourcifyPage(r.address)} target="_blank" rel="noopener noreferrer">
                            <span aria-hidden="true">{WORD[s][lang].slice(0, 1)}</span>
                            <span className="v-check-word">{WORD[s][lang].slice(1)}</span>
                          </a>
                        ) : lang === "zh" ? (
                          "核对中……"
                        ) : (
                          "checking…"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
