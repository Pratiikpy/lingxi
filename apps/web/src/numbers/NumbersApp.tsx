/**
 * Live numbers (plan 4.10): what Lingxi has done on X Layer, read from the chain by Lingxi's indexer and the
 * contracts' own totals. Every number says where it comes from and what it counts, with a link to the contract,
 * so anyone can check it.
 */

import { useEffect, useState } from "react";
import { formatBem } from "@lingxi/chain";
import { formatEther } from "viem";
import { GOALS, GOAL_METHOD, goalAmountText } from "@lingxi/world";
import { useLang } from "../i18n";
import "../agents/agents.css";
import "../tree/tree.css";
import "./numbers.css";

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");

interface Market {
  copies: number;
  paid: string;
  sales: number;
  indexedTo: number;
}
/** How far behind the chain's head a count may be before the page says it is still catching up (~10 minutes). */
const BEHIND = 600;

interface Numbers {
  head: number;
  ok: true;
  at: number;
  pets: { hatched: number; children: number; daysSaved: number; savedLast24h: number; hatchers: number; nextPetId: number; indexedTo: number };
  outfits: { okb: Market | null; bem: Market | null };
  burned: { market: string; breeding: string; shop?: string; adoption?: string; extras?: string; total: string };
  extras?: { room: number; looks: number; colours: number } | null;
  pins: number | null;
  contracts: Record<string, { address: string; url: string }>;
}

type Lang = "en" | "zh";
type Row = { label: [string, string]; value: string; counts: [string, string]; source?: string };

const fmt = (n: number) => n.toLocaleString("en");

/** Each group, and for counts summed from events, the block they are read up to (the slowest of its sources). */
interface GoalsBody {
  indexedTo: number;
  goals: Array<{ id: string; total: number; contributors: number; state: string }>;
}
const dateText = (sec: number, lang: Lang) => new Date(sec * 1000).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", { day: "numeric", month: "short", timeZone: "UTC" });

/** Community goals (plan 4.10): each goal's total against its target, counted from the same chain events. */
function goalRows(g: GoalsBody, lang: Lang): { title: [string, string]; readTo: number; items: Row[] } {
  return {
    title: ["Community goals", "共同目标"],
    readTo: g.indexedTo,
    items: GOALS.map((d) => {
      const r = g.goals.find((x) => x.id === d.id);
      const when = `${dateText(d.start, lang)} – ${dateText(d.end, lang)} (UTC)`;
      return {
        label: [d.title.en, d.title.zh] as [string, string],
        value: `${goalAmountText(d, r?.total ?? 0)} / ${goalAmountText(d, d.target)} ${d.unit[lang]}`,
        counts: [`${GOAL_METHOD[d.metric].en} From ${when}; ${r?.contributors ?? 0} wallet${r?.contributors === 1 ? "" : "s"} so far.`, `${GOAL_METHOD[d.metric].zh} 时间：${when}；目前 ${r?.contributors ?? 0} 个钱包。`] as [string, string],
        source: d.metric === "burned" ? "breeder" : "registry",
      };
    }),
  };
}

function rows(n: Numbers): Array<{ title: [string, string]; readTo?: number; items: Row[] }> {
  const okb = n.outfits.okb;
  const bem = n.outfits.bem;
  return [
    {
      title: ["Pets", "宠物"],
      readTo: n.pets.indexedTo,
      items: [
        { label: ["Pets hatched", "孵化的宠物"], value: fmt(n.pets.hatched), counts: ["Pets hatched from an egg (Hatched events without parents).", "从蛋里孵化的宠物（没有父母的 Hatched 事件）。"], source: "registry" },
        { label: ["Little ones born", "出生的小宝宝"], value: fmt(n.pets.children), counts: ["Pets born of two parents (Bred events).", "由两位父母生下的宠物（Bred 事件）。"], source: "registry" },
        { label: ["Days kept on X Layer", "保存在 X Layer 的天数"], value: fmt(n.pets.daysSaved), counts: ["Every day of a pet's life saved on chain (Checkpoint events).", "宠物生活中每一天的链上存档（Checkpoint 事件）。"], source: "registry" },
        { label: ["Pets saved in the last 24 hours", "过去 24 小时存档的宠物"], value: fmt(n.pets.savedLast24h), counts: ["Distinct pets with at least one save in the last day. Not a count of people: one person can keep several pets.", "过去一天里至少存档过一次的不同宠物。不是人数：一个人可以养好几只。"], source: "registry" },
        { label: ["Wallets that hatched a pet", "孵化过宠物的钱包"], value: fmt(n.pets.hatchers), counts: ["Distinct wallets a pet was hatched or born to.", "宠物孵化或出生时归属的不同钱包。"], source: "registry" },
      ],
    },
    {
      title: ["Fashion", "时装"],
      readTo: Math.min(...[n.outfits.okb, n.outfits.bem].filter((m): m is Market => !!m).map((m) => m.indexedTo), n.head),
      items: [
        ...(bem
          ? [{ label: ["Outfit copies sold for BEM", "用 BEM 卖出的衣服"] as [string, string], value: `${fmt(bem.copies)} · ${formatBem(BigInt(bem.paid))} BEM`, counts: ["Copies bought from creators and from resellers on the BEM market, and what buyers paid (Minted and Sold events).", "BEM 市场上从作者和转卖者那里买走的份数，以及买家付了多少（Minted 和 Sold 事件）。"] as [string, string], source: "marketBem" }]
          : []),
        ...(okb
          ? [{ label: ["Outfit copies sold for OKB", "用 OKB 卖出的衣服"] as [string, string], value: `${fmt(okb.copies)} · ${formatEther(BigInt(okb.paid))} OKB`, counts: ["The first market, from before BEM pricing (Minted and Sold events).", "BEM 定价之前的第一个市场（Minted 和 Sold 事件）。"] as [string, string], source: "marketOkb" }]
          : []),
        ...(n.pins !== null ? [{ label: ["Holder pins claimed", "领取的持有人徽章"] as [string, string], value: fmt(n.pins), counts: ["Free pins given to Test1, Rig, BEM and FAB holders (the gift contract's own count).", "送给 Test1、矿机、BEM 和 FAB 持有人的免费徽章（礼物合约自己的计数）。"] as [string, string], source: "gift" }] : []),
      ],
    },
    {
      title: ["BEM burned", "销毁的 BEM"],
      items: [
        { label: ["Burned by the market", "市场销毁"], value: `${formatBem(BigInt(n.burned.market))} BEM`, counts: ["The market's whole fee, sent to the dead address in the same transaction as each sale (the market's own total).", "市场的全部手续费，在每笔交易里直接送到销毁地址（市场合约自己的累计）。"], source: "marketBem" },
        { label: ["Burned by breeding", "生宝宝销毁"], value: `${formatBem(BigInt(n.burned.breeding))} BEM`, counts: ["Breeding fees, moved from the breeder's wallet straight to the dead address (the breeding contract's own total).", "生宝宝的费用，直接从钱包送到销毁地址（生育合约自己的累计）。"], source: "breeder" },
        ...(n.burned.shop !== undefined
          ? [{ label: ["Burned by the item shop", "道具店销毁"] as [string, string], value: `${formatBem(BigInt(n.burned.shop))} BEM`, counts: ["The whole price of every on-chain piece bought, sent to the dead address in the same transaction (the shop's own total).", "每件链上摆设的全部售价，在购买的同一笔交易里送到销毁地址（道具店合约自己的累计）。"] as [string, string], source: "itemShop" }]
          : []),
        ...(n.burned.adoption !== undefined
          ? [{ label: ["Burned by the adoption centre", "领养中心销毁"] as [string, string], value: `${formatBem(BigInt(n.burned.adoption))} BEM`, counts: ["The fee on every adoption (3% of the price), sent to the dead address by the adopter's own payment (the centre's own total).", "每次领养的手续费（价格的 3%），由领养人付款时直接送到销毁地址（领养中心合约自己的累计）。"] as [string, string], source: "adoption" }]
          : []),
        ...(n.burned.extras !== undefined && n.extras
          ? [
              {
                label: ["Burned by extras", "小额外销毁"] as [string, string],
                value: `${formatBem(BigInt(n.burned.extras))} BEM`,
                counts: [
                  `The whole price of every extra, sent to the dead address in the same transaction: ${fmt(n.extras.room)} room pack${n.extras.room === 1 ? "" : "s"}, ${fmt(n.extras.looks)} look pack${n.extras.looks === 1 ? "" : "s"} and ${fmt(n.extras.colours)} name colour${n.extras.colours === 1 ? "" : "s"} bought (the extras contract's own totals).`,
                  `每样小额外的全部售价，在购买的同一笔交易里送到销毁地址：已买 ${fmt(n.extras.room)} 份房间空间、${fmt(n.extras.looks)} 份存搭配、${fmt(n.extras.colours)} 次名字颜色（小额外合约自己的累计）。`,
                ] as [string, string],
                source: "extras",
              },
            ]
          : []),
        { label: ["Burned in total", "合计销毁"], value: `${formatBem(BigInt(n.burned.total))} BEM`, counts: ["The totals above added together. Lingxi never keeps BEM.", "上面各项之和。灵犀从不留下 BEM。"] },
      ],
    },
  ];
}

export function NumbersApp() {
  const { lang, toggle } = useLang();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [data, setData] = useState<Numbers | null>(null);
  const [err, setErr] = useState(false);
  const [goals, setGoals] = useState<GoalsBody | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "灵犀 · 链上数字" : "Lingxi · live numbers";
  }, [lang]);
  useEffect(() => {
    // the on-chain copy reads the same public endpoint; it is open to any origin
    const base = API || "https://lingxi.knole.me";
    fetch(`${base}/api/numbers`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Numbers & { ok: boolean }) => (j.ok ? setData(j) : setErr(true)))
      .catch(() => setErr(true));
    fetch(`${base}/api/goals`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: GoalsBody & { ok: boolean }) => j.ok && setGoals(j))
      .catch(() => undefined);
  }, []);

  return (
    <main className="agents numbers">
      <header className="v-head">
        <a href="index.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{L("Live numbers", "链上数字")}</h1>
      <p className="ag-lede">
        {L(
          "What Lingxi has done on X Layer, read from the chain: the pets' own records, every outfit sale, and every BEM burned. Each number says what it counts and links to the contract it comes from.",
          "灵犀在 X Layer 上做了什么，全部读自链上：宠物自己的记录、每一笔衣服交易、每一枚销毁的 BEM。每个数字都写明它数的是什么，并链接到它来自的合约。",
        )}
      </p>
      {err && <p className="ag-card">{L("The numbers couldn't be read just now. The chain still has them: try again in a moment.", "暂时读不到这些数字。链上记录还在，请稍后再试。")}</p>}
      {!data && !err && <p className="ag-card tl-loading">{L("Reading the chain…", "正在读取链上记录……")}</p>}
      {data &&
        [...rows(data), ...(goals ? [goalRows(goals, lang as Lang)] : [])].map((group) => (
          <section key={group.title[0]} className="nb-group">
            <h2>{lang === "zh" ? group.title[1] : group.title[0]}</h2>
            {group.readTo !== undefined && data.head - group.readTo > BEHIND && (
              <p className="small nb-behind" role="status">
                {L(
                  `Still reading the chain: up to block ${fmt(group.readTo)} of ${fmt(data.head)}. These counts will rise as it catches up.`,
                  `还在读取链上记录：已读到第 ${fmt(group.readTo)} 个区块，共 ${fmt(data.head)} 个。读完之前，这些数字还会变大。`,
                )}
              </p>
            )}
            <dl className="nb-rows">
              {group.items.map((r) => {
                const src = r.source ? data.contracts[r.source] : undefined;
                return (
                  <div key={r.label[0]} className="nb-row">
                    <dt>{lang === "zh" ? r.label[1] : r.label[0]}</dt>
                    <dd className="nb-value">{r.value}</dd>
                    <dd className="nb-how small">
                      {lang === "zh" ? r.counts[1] : r.counts[0]}{" "}
                      {src && (
                        <a href={src.url} target="_blank" rel="noopener noreferrer">
                          {L("Contract", "合约")} {src.address.slice(0, 6)}…{src.address.slice(-4)}
                        </a>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      {data && (
        <p className="small tl-indexed">
          {L(
            `Pets read up to X Layer block ${fmt(data.pets.indexedTo)}; contract totals read ${new Date(data.at).toLocaleString("en")}. Refreshed every minute.`,
            `宠物记录读到 X Layer 第 ${fmt(data.pets.indexedTo)} 个区块；合约累计读取于 ${new Date(data.at).toLocaleString("zh-CN")}。每分钟刷新。`,
          )}{" "}
          <a href="verify.html">{L("Check a pet's days on the proof page", "在证明页核对宠物的每一天")}</a>
        </p>
      )}
    </main>
  );
}
