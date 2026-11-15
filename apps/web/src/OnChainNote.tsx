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
      "Each pet's brain: a real circuit of NAND and LATCH gates, taped out on TapeOut processor #419, readable by anyone forever.",
      "The pet itself (an NFT in the Lingxi registry): its owner, the brain it runs, its picture and its name once claimed.",
      "Checkpoints, when you save: the brain's memory and a hash of every thought since the last save, so anyone can replay its behaviour.",
      "Red packets (USDT) and pet-sitting permissions, which are contracts.",
      "This site's on-chain copy at 1.2.419.tape (DeWEB).",
    ],
    deviceHead: "On your device only",
    device: [
      "Care between saves, the diary and the rewind (worked out from the thought log on your device).",
      "Coins, items, decorations, badges, spar and daily-challenge records.",
    ],
    serverHead: "Through our server (this web version only)",
    server: [
      "Teaching in plain words and the pet's spoken lines use an AI model (Claude); the rule it proposes is always shown before anything changes.",
      "Live rooms, friends' visits, shared decorations, the shared lesson library and reminders.",
    ],
    noServer: "This on-chain version uses no server at all: AI teaching, voices and live rooms are off.",
  },
  zh: {
    title: "哪些在链上，哪些不在",
    independent: "灵犀是基于 X Layer 和 TapeOut 的独立项目，不是 OKX 或 TapeOut 出品，也未经其背书。",
    chainHead: "在 X Layer 上，任何人都能查",
    chain: [
      "每只宠物的大脑：由与非门和锁存器组成的真实电路，流片在 TapeOut 第 419 号处理器上，永久可读。",
      "宠物本身（灵犀登记册里的 NFT）：主人、它运行的大脑、它的画像，以及认领后的名字。",
      "存档时的检查点：大脑的记忆，和上次存档以来每个念头的哈希，任何人都能重放它的行为。",
      "红包（USDT）和代养权限，都是合约。",
      "本网站在链上的副本 1.2.419.tape（DeWEB）。",
    ],
    deviceHead: "只在你的设备上",
    device: ["两次存档之间的照顾、日记和倒带（由你设备上的念头记录算出）。", "金币、物品、装饰、徽章、切磋和每日挑战的记录。"],
    serverHead: "经过我们的服务器（仅网页版）",
    server: ["用自己的话教它、宠物说的话，用到 AI 模型（Claude）；它提出的规则在改动之前一定先给你看。", "实时房间、朋友来访、共享装饰、共享课程库和提醒。"],
    noServer: "这个链上版本完全不用服务器：AI 教学、说话和实时房间都关掉了。",
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
