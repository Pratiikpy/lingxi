/**
 * Live numbers (plan 4.10): what Lingxi has done on X Layer, read from the chain by Lingxi's indexer and the
 * contracts' own totals. Every number says where it comes from and what it counts, with a link to the contract,
 * so anyone can check it.
 */

import { useEffect, useState } from "react";
import { formatBem } from "@lingxi/chain";
import { formatEther } from "viem";
import { GOAL_METHOD, goalAmountText, goalRoundAt } from "@lingxi/world";
import { useLang } from "../i18n";
import { SiteFoot } from "../SiteFoot";
import { usePageMeta } from "../i18n/pageMeta";
import "../agents/agents.css";
import "../tree/tree.css";
import "./numbers.css";
import { LINGXI_SITE } from "@lingxi/chain/site";

/** An address short enough to wrap on a phone; the market's own link beside it leads to the full record. */
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const API =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

interface Market {
  copies: number;
  paid: string;
  sales: number;
  indexedTo: number;
  /** who bought (C2): the team's own wallets, a creator or seller buying their own, and everyone else */
  byTeam?: { copies: number; paid: string };
  selfBuys?: { copies: number; paid: string };
  byPlayers?: { copies: number; paid: string; buyers: number };
}
type PetSplit = {
  hatched: number;
  children: number;
  saves: number;
  hatchers: number;
  savedLast24h?: number;
  petsSaved?: number;
};
/** How far behind the chain's head a count may be before the page says it is still catching up (~10 minutes). */
const BEHIND = 600;

interface Numbers {
  head: number;
  ok: true;
  at: number;
  pets: {
    hatched: number;
    children: number;
    daysSaved: number;
    savedLast24h: number;
    hatchers: number;
    nextPetId: number;
    indexedTo: number;
    byTeam?: PetSplit;
  };
  /** the team's own wallets (C2): named, and how many more are kept private */
  team?: { wallets: string[]; hidden: number } | null;
  outfits: { okb: Market | null; bem: Market | null };
  burned: { market: string; breeding: string; shop?: string; adoption?: string; extras?: string; total: string };
  /** the last 7 days, who kept the pets, and the circuits taped out (H10) */
  week?: {
    since: number;
    hatched: number;
    children: number;
    saves: number;
    petsSaved: number;
    hatchers: number;
    circuits: number | null;
    byTeam?: PetSplit;
  } | null;
  kept?: { own: number; sponsored: number; other: number; sponsors: string[]; sponsorOn?: boolean } | null;
  circuits?: { total: number; minted: number; last7d: number | null; indexedTo: number; processor: string } | null;
  /** what the OKB market's fee has paid the project (H8) */
  earned?: {
    okb: string;
    feeBps: number;
    treasury: string;
    toProject: boolean;
    indexedTo: number;
    fromTeam?: string;
  } | null;
  extras?: { room: number; looks: number; colours: number } | null;
  pins: number | null;
  usedByOthers?: {
    circuits: number;
    processors: number;
    scannedProcessors: number;
    cpuCount: number;
    complete: boolean;
  } | null;
  contracts: Record<string, { address: string; url: string }>;
}

type Lang = "en" | "zh";
/** `team`: how much of the figure is the team's own activity (C2), shown under the value */
type Row = {
  label: [string, string];
  value: string;
  counts: [string, string];
  source?: string;
  team?: [string, string];
};

/** "of which the team's: n" for a count, or nothing when the team list is not served */
const teamLine = (n: number | undefined, total: number): [string, string] | undefined =>
  n === undefined || total === 0
    ? undefined
    : n === total
      ? ["All of it the team's own testing", "全部是团队自己的测试"]
      : [
          `The team's own: ${fmt(n)} · everyone else: ${fmt(Math.max(0, total - n))}`,
          `团队自己的：${fmt(n)} · 其他人：${fmt(Math.max(0, total - n))}`,
        ];

const fmt = (n: number) => n.toLocaleString("en");

/** Each group, and for counts summed from events, the block they are read up to (the slowest of its sources). */
interface GoalsBody {
  indexedTo: number;
  goals: Array<{ id: string; total: number; contributors: number; state: string }>;
}
const dateText = (sec: number, lang: Lang) =>
  new Date(sec * 1000).toLocaleDateString(lang === "zh" ? "zh-CN" : "en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Community goals (plan 4.10): each goal's total against its target, counted from the same chain events. */
function goalRows(g: GoalsBody, lang: Lang): { title: [string, string]; readTo: number; items: Row[] } {
  return {
    title: ["Community goals", "共同目标"],
    readTo: g.indexedTo,
    // the round running now (G4); a round that has ended keeps its totals in its own row until the next begins
    items: goalRoundAt(Math.floor(Date.now() / 1000)).goals.map((d) => {
      const r = g.goals.find((x) => x.id === d.id);
      const when = `${dateText(d.start, lang)} – ${dateText(d.end, lang)} (UTC)`;
      return {
        label: [d.title.en, d.title.zh] as [string, string],
        value: `${goalAmountText(d, r?.total ?? 0)} / ${goalAmountText(d, d.target)} ${d.unit[lang]}`,
        counts: [
          `${GOAL_METHOD[d.metric].en} From ${when}; ${r?.contributors ?? 0} wallet${r?.contributors === 1 ? "" : "s"} so far.`,
          `${GOAL_METHOD[d.metric].zh} 时间：${when}；目前 ${r?.contributors ?? 0} 个钱包。`,
        ] as [string, string],
        source: d.metric === "burned" ? "breeder" : "registry",
      };
    }),
  };
}

type Section = { title: [string, string]; readTo?: number; items: Row[] };

/** The page's sections, in order; one that has nothing to show yet gives none. */
function rows(n: Numbers, lang: Lang): Section[] {
  return [
    ...lastWeek(n),
    ...petsSection(n),
    ...circuitsSection(n, lang),
    ...fashionSection(n),
    ...circuitsOthersSection(n),
    ...bemSection(n),
    ...earnedSection(n),
  ];
}

function lastWeek(n: Numbers): Section[] {
  const w = n.week;
  return w
    ? [
        {
          title: ["The last 7 days", "过去 7 天"] as [string, string],
          readTo: n.pets.indexedTo,
          items: [
            {
              label: ["Pets hatched", "孵化的宠物"] as [string, string],
              value: fmt(w.hatched),
              counts: [
                "Pets hatched from an egg in the last 7 days, by the time of their block.",
                "过去 7 天里从蛋里孵化的宠物，按所在区块的时间。",
              ] as [string, string],
              source: "registry",
              team: teamLine(w.byTeam?.hatched, w.hatched),
            },
            {
              label: ["Little ones born", "出生的小宝宝"] as [string, string],
              value: fmt(w.children),
              counts: ["Pets born of two parents in the last 7 days.", "过去 7 天里由两位父母生下的宠物。"] as [
                string,
                string,
              ],
              source: "registry",
              team: teamLine(w.byTeam?.children, w.children),
            },
            {
              label: ["Days saved", "保存的天数"] as [string, string],
              value: fmt(w.saves),
              counts: [
                "Saves on chain in the last 7 days (Checkpoint events).",
                "过去 7 天里在链上的保存（Checkpoint 事件）。",
              ] as [string, string],
              source: "registry",
              team: teamLine(w.byTeam?.saves, w.saves),
            },
            {
              label: ["Pets saved", "存档过的宠物"] as [string, string],
              value: fmt(w.petsSaved),
              counts: [
                "Distinct pets saved at least once in the last 7 days. Not a count of people.",
                "过去 7 天里至少存档一次的不同宠物。不是人数。",
              ] as [string, string],
              source: "registry",
              team: teamLine(w.byTeam?.petsSaved, w.petsSaved),
            },
            {
              label: ["Wallets that hatched", "孵化过宠物的钱包"] as [string, string],
              value: fmt(w.hatchers),
              counts: [
                "Distinct wallets a pet was hatched or born to in the last 7 days.",
                "过去 7 天里宠物孵化或出生时归属的不同钱包。",
              ] as [string, string],
              source: "registry",
              team: teamLine(w.byTeam?.hatchers, w.hatchers),
            },
            ...(w.circuits !== null && w.circuits !== undefined
              ? [
                  {
                    label: ["Circuits taped out", "流片的电路"] as [string, string],
                    value: fmt(w.circuits),
                    counts: [
                      "New circuits taped out on Lingxi's processor in the last 7 days (a pet whose mind is already there reuses it).",
                      "过去 7 天在灵犀的处理器上新流片的电路（心智已经在链上的宠物会直接复用）。",
                    ] as [string, string],
                    source: "processor",
                  },
                ]
              : []),
          ],
        },
      ]
    : [];
}

function petsSection(n: Numbers): Section[] {
  const k = n.kept;
  return [
    {
      title: ["Pets", "宠物"],
      readTo: n.pets.indexedTo,
      items: [
        {
          label: ["Pets hatched", "孵化的宠物"],
          value: fmt(n.pets.hatched),
          counts: [
            "Pets hatched from an egg (Hatched events without parents).",
            "从蛋里孵化的宠物（没有父母的 Hatched 事件）。",
          ],
          source: "registry",
          team: teamLine(n.pets.byTeam?.hatched, n.pets.hatched),
        },
        {
          label: ["Little ones born", "出生的小宝宝"],
          value: fmt(n.pets.children),
          counts: ["Pets born of two parents (Bred events).", "由两位父母生下的宠物（Bred 事件）。"],
          source: "registry",
          team: teamLine(n.pets.byTeam?.children, n.pets.children),
        },
        {
          label: ["Days kept on X Layer", "保存在 X Layer 的天数"],
          value: fmt(n.pets.daysSaved),
          counts: [
            "Days a pet was saved on chain, counted over every pet (Checkpoint events).",
            "所有宠物在链上保存过的天数之和（Checkpoint 事件）。",
          ],
          source: "registry",
          team: teamLine(n.pets.byTeam?.saves, n.pets.daysSaved),
        },
        {
          label: ["Pets saved in the last 24 hours", "过去 24 小时存档的宠物"],
          value: fmt(n.pets.savedLast24h),
          counts: [
            "Distinct pets with at least one save in the last day. Not a count of people: one person can keep several pets.",
            "过去一天里至少存档过一次的不同宠物。不是人数：一个人可以养好几只。",
          ],
          source: "registry",
          team: teamLine(n.pets.byTeam?.savedLast24h, n.pets.savedLast24h),
        },
        {
          label: ["Wallets that hatched a pet", "孵化过宠物的钱包"],
          value: fmt(n.pets.hatchers),
          counts: ["Distinct wallets a pet was hatched or born to.", "宠物孵化或出生时归属的不同钱包。"],
          source: "registry",
          team: teamLine(n.pets.byTeam?.hatchers, n.pets.hatchers),
        },
        ...(k
          ? [
              {
                label: ["Kept by their owner's own wallet", "由主人自己的钱包留在链上"] as [string, string],
                value: fmt(k.own),
                counts: [
                  "Pets whose hatch was sent by the very wallet it was hatched for: the owner paid for keeping it.",
                  "孵化交易由宠物所属的那个钱包自己发出：主人自己付费上链。",
                ] as [string, string],
                source: "registry",
              },
              {
                label: ["Kept for them by Lingxi (free)", "由灵犀免费代为上链"] as [string, string],
                value: fmt(k.sponsored),
                ...(k.sponsorOn === false
                  ? {
                      team: [
                        "Switched off for now: Lingxi is not keeping pets for free at the moment.",
                        "目前已关闭：灵犀暂时不免费代为上链。",
                      ] as [string, string],
                    }
                  : {}),
                counts: [
                  `Pets hatched by Lingxi's relayer${k.sponsors[0] ? ` (${shortAddr(k.sponsors[0])})` : ""} for a player with no wallet, paid by Lingxi.`,
                  `由灵犀的中继${k.sponsors[0] ? `（${shortAddr(k.sponsors[0])}）` : ""}为没有钱包的玩家孵化上链，费用由灵犀支付。`,
                ] as [string, string],
                source: "registry",
              },
              {
                label: ["Kept by another wallet", "由别的钱包代为上链"] as [string, string],
                value: fmt(k.other),
                counts: [
                  "Pets whose hatch was sent by a wallet that is neither its owner nor Lingxi's relayer.",
                  "孵化交易既不是主人也不是灵犀中继发出的宠物。",
                ] as [string, string],
                source: "registry",
              },
            ]
          : []),
      ],
    },
  ];
}

function circuitsSection(n: Numbers, lang: Lang): Section[] {
  const c = n.circuits;
  return c
    ? [
        {
          title: ["Circuits on Lingxi's processor", "灵犀处理器上的电路"] as [string, string],
          readTo: c.indexedTo,
          items: [
            {
              label: ["Circuits taped out", "流片的电路"] as [string, string],
              value: fmt(c.total),
              counts: [
                "The processor's own count (nextId, the number of its latest circuit): every circuit taped out on it, the pet minds, children, instincts and rules Lingxi's relayer puts there and any a player tapes out with their own wallet. A pet whose mind is already there reuses it, so this grows with new minds, not with pets. The mints walked so far: " +
                  fmt(c.minted) +
                  ".",
                "处理器自己的计数（nextId，即最新一个电路的编号）：在它上面流片的每个电路，包括灵犀中继放上去的宠物心智、孩子、本能和规则，以及玩家用自己钱包流片的电路。心智已经在链上的宠物会直接复用，所以这个数随新心智增长，而不是随宠物增长。目前读到的铸造：" +
                  fmt(c.minted) +
                  "。",
              ] as [string, string],
              source: "processor",
            },
            {
              label: ["In the last 7 days", "过去 7 天"] as [string, string],
              value: c.last7d === null ? (lang === "zh" ? "读取中" : "still reading") : fmt(c.last7d),
              counts: [
                "Circuits taped out in the last 7 days: the processor's count now less its count at the first block of the 7 days, read from X Layer (the walk of every mint is the recount's check on it).",
                "过去 7 天流片的电路：处理器现在的计数减去 7 天前第一个区块时的计数，从 X Layer 读出（逐一读取每次铸造是重算时对它的核对）。",
              ] as [string, string],
              source: "processor",
            },
          ],
        },
      ]
    : [];
}

function fashionSection(n: Numbers): Section[] {
  const okb = n.outfits.okb;
  const bem = n.outfits.bem;
  return [
    {
      title: ["Fashion", "时装"],
      readTo: Math.min(
        ...[n.outfits.okb, n.outfits.bem].filter((m): m is Market => !!m).map((m) => m.indexedTo),
        n.head,
      ),
      items: [
        ...(bem
          ? [
              {
                label: ["Outfit copies sold for BEM", "用 BEM 卖出的衣服"] as [string, string],
                value: `${fmt(bem.copies)} · ${formatBem(BigInt(bem.paid))} BEM`,
                counts: [
                  "Copies bought from creators and from resellers on the BEM market, and what buyers paid (Minted and Sold events).",
                  "BEM 市场上从作者和转卖者那里买走的份数，以及买家付了多少（Minted 和 Sold 事件）。",
                ] as [string, string],
                source: "marketBem",
                team: buyersLine(bem, "BEM"),
              },
            ]
          : []),
        ...(okb
          ? [
              {
                label: ["Outfit copies sold for OKB", "用 OKB 卖出的衣服"] as [string, string],
                value: `${fmt(okb.copies)} · ${formatEther(BigInt(okb.paid))} OKB`,
                counts: [
                  "Copies bought from creators and from resellers on the OKB market, and what buyers paid (Minted and Sold events).",
                  "OKB 市场上从作者和转卖者那里买走的份数，以及买家付了多少（Minted 和 Sold 事件）。",
                ] as [string, string],
                source: "marketOkb",
                team: buyersLine(okb, "OKB"),
              },
            ]
          : []),
        ...(n.pins !== null
          ? [
              {
                label: ["Holder pins claimed", "领取的持有人徽章"] as [string, string],
                value: fmt(n.pins),
                counts: [
                  "Free pins claimed by TapeCode-Test1 and Rig holders, and by wallets that held BEM or FAB at the snapshot (block 76,052,000); the gift contract's own count.",
                  "TapeCode-Test1 和矿机的持有人，以及在快照时（第 76,052,000 个区块）持有 BEM 或 FAB 的钱包领取的免费徽章（礼物合约自己的计数）。",
                ] as [string, string],
                source: "gift",
              },
            ]
          : []),
      ],
    },
  ];
}

function circuitsOthersSection(n: Numbers): Section[] {
  return n.usedByOthers
    ? [
        {
          title: ["Circuits others use", "别人用的电路"] as [string, string],
          items: [
            {
              label: ["Circuits on other processors that use Lingxi's", "别的处理器上用到灵犀电路的电路"] as [
                string,
                string,
              ],
              value: `${fmt(n.usedByOthers.circuits)} · ${fmt(n.usedByOthers.processors)} ${n.usedByOthers.processors === 1 ? "processor" : "processors"}`,
              counts: [
                `Circuits on other TapeOut processors whose netlists REF a Lingxi circuit, read from chain (every processor TapeOut's factory made; ${n.usedByOthers.complete ? "all read" : `still reading: ${fmt(n.usedByOthers.scannedProcessors)} of ${fmt(Math.max(0, n.usedByOthers.cpuCount - 1))} so far`}). The catalogue of circuits anyone can call is at circuits.html.`,
                `别的 TapeOut 处理器上，网表里 REF 了灵犀电路的电路，从链上读出（TapeOut 工厂造出的每一个处理器；${n.usedByOthers.complete ? "已全部读完" : `还在读：已读 ${fmt(n.usedByOthers.scannedProcessors)} / ${fmt(Math.max(0, n.usedByOthers.cpuCount - 1))}`}）。任何人都能调用的电路目录在 circuits.html。`,
              ] as [string, string],
            },
          ],
        },
      ]
    : [];
}

function bemSection(n: Numbers): Section[] {
  return [
    {
      title: ["BEM burned", "销毁的 BEM"],
      items: [
        {
          label: ["Burned by the market", "市场销毁"],
          value: `${formatBem(BigInt(n.burned.market))} BEM`,
          counts: [
            "The market's whole fee, sent to the dead address in the same transaction as each sale (the market's own total).",
            "市场的全部手续费，在每笔交易里直接送到销毁地址（市场合约自己的累计）。",
          ],
          source: "marketBem",
        },
        {
          label: ["Burned by breeding", "生宝宝销毁"],
          value: `${formatBem(BigInt(n.burned.breeding))} BEM`,
          counts: [
            "Breeding fees, moved from the breeder's wallet straight to the dead address (the breeding contract's own total).",
            "生宝宝的费用，直接从钱包送到销毁地址（生育合约自己的累计）。",
          ],
          source: "breeder",
        },
        ...(n.burned.shop !== undefined
          ? [
              {
                label: ["Burned by the item shop", "道具店销毁"] as [string, string],
                value: `${formatBem(BigInt(n.burned.shop))} BEM`,
                counts: [
                  "The whole price of every on-chain piece bought, sent to the dead address in the same transaction (the shop's own total).",
                  "每件链上摆设的全部售价，在购买的同一笔交易里送到销毁地址（道具店合约自己的累计）。",
                ] as [string, string],
                source: "itemShop",
              },
            ]
          : []),
        ...(n.burned.adoption !== undefined
          ? [
              {
                label: ["Burned by the adoption centre", "领养中心销毁"] as [string, string],
                value: `${formatBem(BigInt(n.burned.adoption))} BEM`,
                counts: [
                  "The fee on every adoption (3% of the price), sent to the dead address by the adopter's own payment (the centre's own total).",
                  "每次领养的手续费（价格的 3%），由领养人付款时直接送到销毁地址（领养中心合约自己的累计）。",
                ] as [string, string],
                source: "adoption",
              },
            ]
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
        {
          label: ["Burned in total", "合计销毁"],
          value: `${formatBem(BigInt(n.burned.total))} BEM`,
          counts: [
            "The totals above added together: every one was sent straight to the dead address, none of it to Lingxi.",
            "上面各项之和：每一笔都直接送到销毁地址，没有一枚给灵犀。",
          ],
        },
      ],
    },
  ];
}

function earnedSection(n: Numbers): Section[] {
  const okb = n.outfits.okb;
  return n.earned && okb
    ? [
        {
          title: ["Earned by the project", "项目的收入"] as [string, string],
          items: [
            {
              label: ["From the OKB outfit market", "来自 OKB 衣服市场"] as [string, string],
              value: `${formatEther(BigInt(n.earned.okb))} OKB`,
              counts: [
                `The OKB market's fee, ${n.earned.feeBps / 100}% of every sale, paid to the project wallet ${shortAddr(n.earned.treasury)} to fund the game; counted sale by sale at the rate in force (the market keeps no fee total), out of ${formatEther(BigInt(okb.paid))} OKB in sales.${n.earned.toProject ? "" : " The fee now goes to another wallet, so sales from now on add nothing here."} BEM fees are never earned: they are burned.`,
                `OKB 市场的手续费：每笔交易的 ${n.earned.feeBps / 100}%，付给项目钱包 ${shortAddr(n.earned.treasury)}，用来维持游戏；按每笔交易当时的费率逐笔计算（市场合约不记手续费总额），来自共 ${formatEther(BigInt(okb.paid))} OKB 的交易。${n.earned.toProject ? "" : "手续费现在付给另一个钱包，之后的交易不再计入这里。"}BEM 的费用从不是收入：全部销毁。`,
              ] as [string, string],
              source: "marketOkb",
              ...(n.earned.fromTeam !== undefined
                ? {
                    team:
                      BigInt(n.earned.fromTeam) === BigInt(n.earned.okb) && BigInt(n.earned.okb) > 0n
                        ? ([
                            "All of it from the team's own test purchases: the team paying itself, not income.",
                            "全部来自团队自己的测试购买：团队付给自己，不是收入。",
                          ] as [string, string])
                        : ([
                            `From players: ${formatEther(BigInt(n.earned.okb) - BigInt(n.earned.fromTeam))} OKB · from the team's own test purchases: ${formatEther(BigInt(n.earned.fromTeam))} OKB`,
                            `来自玩家：${formatEther(BigInt(n.earned.okb) - BigInt(n.earned.fromTeam))} OKB · 来自团队自己的测试购买：${formatEther(BigInt(n.earned.fromTeam))} OKB`,
                          ] as [string, string]),
                  }
                : {}),
            },
          ],
        },
      ]
    : [];
}

/** Who bought a market's copies (C2): the team's own wallets, creators or sellers buying their own, and other players. */
function buyersLine(m: Market, coin: "OKB" | "BEM"): [string, string] | undefined {
  if (!m.byTeam || !m.selfBuys || !m.byPlayers) return undefined;
  const paid = (x: string) => (coin === "OKB" ? formatEther(BigInt(x)) : formatBem(BigInt(x)));
  const p = m.byPlayers;
  return [
    `Bought by ${fmt(p.buyers)} player wallet${p.buyers === 1 ? "" : "s"} outside the team: ${fmt(p.copies)} (${paid(p.paid)} ${coin}) · by the team's own wallets: ${fmt(m.byTeam.copies)} · creators or sellers buying their own: ${fmt(m.selfBuys.copies)}`,
    `团队以外的 ${fmt(p.buyers)} 个玩家钱包买走：${fmt(p.copies)} 份（${paid(p.paid)} ${coin}）· 团队自己的钱包：${fmt(m.byTeam.copies)} 份 · 作者或卖家买自己的：${fmt(m.selfBuys.copies)} 份`,
  ];
}

/**
 * Whose activity the figures are (C2): the team's own wallets, named (and how many more are kept private), and the plain
 * truth when nobody outside the team has hatched a pet or bought an outfit yet.
 */
function TeamCard({ data, lang }: { data: Numbers; lang: Lang }) {
  const t = data.team!;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const teamPets = (data.pets.byTeam?.hatched ?? 0) + (data.pets.byTeam?.children ?? 0);
  const playerPets = data.pets.hatched + data.pets.children - teamPets;
  const playerCopies = (data.outfits.okb?.byPlayers?.copies ?? 0) + (data.outfits.bem?.byPlayers?.copies ?? 0);
  const onlyTeam = playerPets === 0 && playerCopies === 0;
  const sep = lang === "zh" ? "、" : ", ";
  return (
    <section className="ag-card nb-team-card" aria-label={L("Whose activity this is", "这些是谁的活动")}>
      <h2>{L("Whose activity this is", "这些是谁的活动")}</h2>
      <p>
        {onlyTeam
          ? L(
              "So far every figure here is the team's own testing: nobody outside the team has hatched a pet or bought an outfit yet.",
              "到目前为止，这里的每个数字都是团队自己的测试：团队以外还没有人孵化宠物或买衣服。",
            )
          : L(
              `Players outside the team have hatched ${fmt(playerPets)} pet${playerPets === 1 ? "" : "s"} and bought ${fmt(playerCopies)} outfit cop${playerCopies === 1 ? "y" : "ies"}; each figure below shows the team's own share apart.`,
              `团队以外的玩家已经孵化了 ${fmt(playerPets)} 只宠物，买了 ${fmt(playerCopies)} 份衣服；下面每个数字都把团队自己的部分分开列出。`,
            )}
      </p>
      <p className="small">
        {L("The team's wallets: ", "团队的钱包：")}
        {t.wallets.map((w, i) => (
          <span key={w}>
            {i > 0 && sep}
            <span className="nb-addr">{shortAddr(w)}</span>
          </span>
        ))}
        {t.hidden > 0
          ? L(`, and ${t.hidden} more kept private, counted with them.`, `，另有 ${t.hidden} 个不公开，同样计入团队。`)
          : "."}
      </p>
    </section>
  );
}

/** How often the page reads the numbers again; the server keeps them a minute. */
const REFRESH_MS = 60_000;

export function NumbersApp() {
  const { lang, toggle } = useLang();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [data, setData] = useState<Numbers | null>(null);
  const [err, setErr] = useState(false);
  const [goals, setGoals] = useState<GoalsBody | null>(null);

  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("numbers");
  useEffect(() => {
    // the on-chain copy reads the same public endpoint; it is open to any origin
    const base = API || LINGXI_SITE;
    const read = () => {
      fetch(`${base}/api/numbers`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: Numbers & { ok: boolean }) => {
          if (j.ok) {
            setData(j);
            setErr(false);
          } else setErr(true);
        })
        // numbers already shown stay; the message shows only when there are none
        .catch(() => setErr(true));
      fetch(`${base}/api/goals`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: GoalsBody & { ok: boolean }) => j.ok && setGoals(j))
        // the goals have their own page; here they show only once read, and the figures above do not wait on them
        .catch(() => undefined);
    };
    read();
    // read again each minute, as the page says, while it is in view (A65)
    const every = setInterval(() => document.visibilityState === "visible" && read(), REFRESH_MS);
    const shown = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", shown);
    };
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
          "What Lingxi has done on X Layer, read from the chain by Lingxi's server and at most a minute old: the pets' own records, every outfit sale, and every BEM burned. Each number says what it counts and links to the contract it comes from.",
          "灵犀在 X Layer 上做了什么，由灵犀的服务器从链上读出，最多晚一分钟：宠物自己的记录、每一笔衣服交易、每一枚销毁的 BEM。每个数字都写明它数的是什么，并链接到它来自的合约。",
        )}
      </p>
      {data?.team && <TeamCard data={data} lang={lang as Lang} />}
      {err && !data && (
        <p className="ag-card">
          {L(
            "The numbers couldn't be read just now. The chain still has them: try again in a moment.",
            "暂时读不到这些数字。链上记录还在，请稍后再试。",
          )}
        </p>
      )}
      {!data && !err && <p className="ag-card tl-loading">{L("Reading the chain…", "正在读取链上记录……")}</p>}
      {data &&
        [...rows(data, lang as Lang), ...(goals ? [goalRows(goals, lang as Lang)] : [])].map((group) => (
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
                    {r.team && <dd className="nb-team small">{lang === "zh" ? r.team[1] : r.team[0]}</dd>}
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
            `Pets read up to X Layer block ${fmt(data.pets.indexedTo)}; contract totals read ${new Date(data.at).toLocaleString("en", { timeZoneName: "short" })}. Refreshed every minute.`,
            `宠物记录读到 X Layer 第 ${fmt(data.pets.indexedTo)} 个区块；合约累计读取于 ${new Date(data.at).toLocaleString("zh-CN", { timeZoneName: "short" })}。每分钟刷新。`,
          )}{" "}
          <a href="verify.html">{L("Check a pet's days on the proof page", "在证明页核对宠物的每一天")}</a>
        </p>
      )}
      <SiteFoot lang={lang} />
    </main>
  );
}
