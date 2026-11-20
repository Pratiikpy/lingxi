/**
 * The plain note on every page (PRD F20): what lives on X Layer, what stays on
 * the player's device, and what passes through our server. Written to be true on
 * the worst day: nothing here is a promise the code does not keep.
 */

import "./onchain-note.css";

type Lang = "en" | "zh";

// the on-chain (DeWEB) build ships with no server address; the web build has one
const SERVER = ((import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "")) !== "";

const TEXT = {
  en: {
    title: "What is on chain, and what is not",
    independent: "Lingxi is an independent project built on X Layer and TapeOut. It is not made or endorsed by OKX or TapeOut.",
    chainHead: "On X Layer, for anyone to check",
    chain: [
      "Once you keep a pet there: its brain, a real circuit of NAND and LATCH gates, taped out on TapeOut processor #419 and readable by anyone forever.",
      "The pet itself (an NFT in the Lingxi registry): its owner, the brain it runs, its picture and its name once claimed.",
      "Checkpoints, when you save: the brain's memory and a hash chained over every input the pet has had since it hatched, so anyone with its log can replay its behaviour.",
      "The game's rules for finds, trust, skill tiers and how each resident and builder pet greets you: 17 small circuits on the same processor, checked against the game's own rules each time the game opens.",
      "Red packets (USDT) and pet-sitting permissions, which are contracts.",
      "This site's on-chain copy at 1.2.419.tape (DeWEB).",
    ],
    deviceHead: "On your device only",
    device: [
      "Care between saves, the rewind, and the diary until you publish it (worked out from the thought log on your device).",
      "Coins, items, decorations, badges, spar and daily-challenge records.",
    ],
    serverHead: "Through our server (this web version only)",
    server: [
      "Teaching in plain words and the pet's spoken lines use an AI model (Claude); the rule it proposes is always shown before anything changes.",
      "Live rooms, friends' visits, shared decorations, the shared lesson library and reminders.",
      "The game's reads of X Layer and the transactions your wallet signs, which it forwards to X Layer's public nodes (it cannot change what your wallet signed).",
      "What you choose to send: a save moved to another device (held 15 minutes), a published diary, short duel links, arena and season entries (your pet's card), a pet left with a friend, adoption papers, and new minds for Lingxi to tape out.",
      "What the game reads from it: the time, mail, whether it is up, the weekly season, arena opponents and sparring partners, duel links, lessons from the library, a pet left with a friend, adoption papers, published diaries and each pet's history, breeding consents, red-packet claims, item vouchers, retired market listings and Sourcify's verdicts on the contracts; and, read by the server from X Layer, the daily challenge's block, the family tree, Builders' Lane's tape-out count, goals and the numbers.",
    ],
    noServer: "This on-chain version runs without a server of its own: AI teaching, voices and live rooms are off. Its proof page asks Lingxi's indexer only for public things (which transactions to read, an owner's published log) and proves each one on X Layer before it is shown.",
  },
  zh: {
    title: "哪些在链上，哪些不在",
    independent: "灵犀是基于 X Layer 和 TapeOut 的独立项目，不是 OKX 或 TapeOut 出品，也未经其背书。",
    chainHead: "在 X Layer 上，任何人都能查",
    chain: [
      "你把宠物留在链上之后：它的大脑，由与非门和锁存器组成的真实电路，流片在 TapeOut 第 419 号处理器上，永久可读。",
      "宠物本身（灵犀登记册里的 NFT）：主人、它运行的大脑、它的画像，以及认领后的名字。",
      "存档时的检查点：大脑的记忆，和从孵化起每一次输入串成的哈希链，任何人拿到它的日志都能重放它的行为。",
      "游戏里寻找、信任、技能层级，以及每位居民和建造者宠物怎样跟你打招呼的规则：同一台处理器上的 17 个小电路，每次打开游戏都会和游戏自己的规则核对。",
      "红包（USDT）和代养权限，都是合约。",
      "本网站在链上的副本 1.2.419.tape（DeWEB）。",
    ],
    deviceHead: "只在你的设备上",
    device: ["两次存档之间的照顾、倒带，以及你发布之前的日记（由你设备上的念头记录算出）。", "金币、物品、装饰、徽章、切磋和每日挑战的记录。"],
    serverHead: "经过我们的服务器（仅网页版）",
    server: [
      "用自己的话教它、宠物说的话，用到 AI 模型（Claude）；它提出的规则在改动之前一定先给你看。",
      "实时房间、朋友来访、共享装饰、共享课程库和提醒。",
      "游戏对 X Layer 的读取，以及你的钱包签好的交易，由它转发给 X Layer 的公共节点（它改不了你钱包签过的内容）。",
      "你选择发送的：搬到另一台设备的存档（保留 15 分钟）、发布的日记、短的切磋链接、竞技场和赛季的参赛（宠物的卡片）、托朋友照看的宠物、领养文书，以及请灵犀流片的新心智。",
      "游戏从它读取的：时间、邮件、它是否在线、每周赛季、竞技场对手和陪练、切磋链接、课程库里的课、托朋友照看的宠物、领养文书、发布的日记和每只宠物的经历、繁育同意、红包领取记录、道具兑换券、下架的市场挂单，以及 Sourcify 对合约的核验结果；还有服务器从 X Layer 读来的每日挑战区块、家族树、建设者小巷的流片计数、目标和各项数字。",
    ],
    noServer: "这个链上版本不带自己的服务器：AI 教学、说话和实时房间都关掉了。它的验证页只向灵犀的索引服务要公开的东西（该读哪些交易、主人发布的日志），每一样都先在 X Layer 上核对再显示。",
  },
} as const;

export function OnChainNote({ lang, open = false }: { lang: Lang; open?: boolean }) {
  const t = TEXT[lang];
  return (
    <details className="onchain-note" open={open}>
      <summary>{t.title}</summary>
      <p>{t.independent}</p>
      <h4>{t.chainHead}</h4>
      <ul>
        {t.chain.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <h4>{t.deviceHead}</h4>
      <ul>
        {t.device.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      {SERVER ? (
        <>
          <h4>{t.serverHead}</h4>
          <ul>
            {t.server.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>{t.noServer}</p>
      )}
    </details>
  );
}
