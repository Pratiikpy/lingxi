/**
 * The proof page's words, in English and Chinese, and the small helpers that word what it found (P7: out of
 * VerifyApp, so the page and its panels share one copy).
 */

export const T = {
  en: {
    title: "Verify a Lingxi pet",
    lede: "Every Lingxi pet's mind is a circuit of NAND gates and latches; once its owner keeps it on X Layer, that circuit is taped out there. This page reads the chain from your browser through X Layer's public RPCs (or your own) and checks the pet's thoughts with an open evaluator, so you never have to trust the game.",
    id: "Pet number",
    load: "Read from X Layer",
    reading: "Reading this pet from X Layer…",
    owner: "Owner",
    brain: "Brain circuit",
    gates: "gates",
    memory: "memory bits",
    days: "Days saved",
    log: "Committed input log",
    meters: "Saved state",
    proven: "Memory, proven by replay",
    savedOnly: "Memory as saved",
    savedOnlyNote: "Proven once a log replays to it: the published diary or a log file, below.",
    reported: "Reported by the owner",
    reportedNote:
      "The owner's game writes the rest of the state word when it saves a day; the chain keeps it but cannot check it. Only the memory bits are proven, by the log check below.",
    run: "Compare 32 random steps of its circuit",
    running: "Asking the processor...",
    match: "match",
    differ: "differ",
    allOk:
      "All {n} steps match: at its saved memory and at 31 random memories, each with a random input, the processor on X Layer and the open evaluator give the same next memory and outputs.",
    someBad: "{n} steps differ. Report this; it should never happen.",
    comparing: "{k} of 32 compared…",
    bitOrder: "memory, bit 0 first",
    logNotLog: "This file isn't a Lingxi log: it could not be read as one.",
    logUnread: "X Layer couldn't be read to finish this check just now. Try again in a moment.",
    logTitle: "Check a day's log",
    logPick: "Choose a log file",
    logNone: "No file chosen",
    logHelp:
      "Drop the log file the game exports (Pet → Download log). We recompute its hash chain and replay every beat.",
    logOk:
      "The log's hash equals the one on chain, every brain it names is anchored to this pet's own events on X Layer ({a}), and replaying its {n} gives exactly the saved memory.",
    notAnchored: "The log's hash matches, but its brains could not be anchored to this pet's events on X Layer: {why}",
    logBadHash: "This log does not hash to the value on chain.",
    logBadState: "The hash matches, but the replay ends at a different memory than the one saved.",
    logFromBirth:
      "This log runs from the pet's birth in the browser, before it was kept on X Layer: Lingxi kept pets that way until 20 November. Replayed from the memory every new pet starts with, its {n} give exactly the saved memory, but X Layer did not record that starting memory, so this is not a proof anchored on chain.",
    notFound: "No pet with that number.",
    tooBig:
      "This pet's brain on X Layer would run {n} gates each beat, more than any pet's mind can ({max}), so this page will not run it.",
    circuitUnread: "Its circuit couldn't be read from X Layer just now. Try again in a moment.",
    picture: "Its picture, drawn on chain",
    pictureNote:
      "PetLook draws this from the pet's saved state: its stage, its mood and whether its circuit glows. This page only shows what the chain returns.",
    pictureSame: "Pixel for pixel the game's own art for this state.",
    pictureDiff: "This picture differs from the game's art for this state.",
    unsaved:
      "Born on X Layer from #{a} and #{b}, and its first day is not saved yet: the chain holds only the memory the Breeder mixed for it, so until its owner saves a day PetLook draws an egg and every meter reads 0. Those zeros are not its state.",
    lineMismatch:
      "PetRegistry records this pet as the {recorded} line, but its saved state is a {state} pet's, and that is what it is drawn and thinks as. It was hatched that way; the game can no longer write such a pet, and the checks below are unaffected.",
    lines: ["gentle", "bold", "curious"],
    otherStarter:
      "This is the {starter} starter brain, while PetRegistry records the pet as {line}: a test hatch from 15 November, before the game checked that a pet's line and brain agree. The chain records exactly that, and every check below reads what it holds.",
    named: "Name on chain",
    notDeployed: "This build is not connected to a deployment.",
    want: "want",
    inputs: "inputs",
    state: "memory",
  },
  zh: {
    title: "验证一只灵犀宠物",
    lede: "每只灵犀宠物的心智都是一块由与非门和锁存器组成的电路；主人把它留在 X Layer 上之后，这块电路就在链上流片。本页由你的浏览器通过 X Layer 的公共 RPC（或你自己的）读取链上数据，用开源求值器核对它的念头，你不需要相信游戏本身。",
    id: "宠物编号",
    load: "从 X Layer 读取",
    reading: "正在从 X Layer 读取这只宠物…",
    owner: "主人",
    brain: "大脑电路",
    gates: "个门",
    memory: "位记忆",
    days: "已保存天数",
    log: "已承诺的输入日志",
    meters: "保存的状态",
    proven: "记忆，由重放证明",
    savedOnly: "保存的记忆",
    savedOnlyNote: "等日志重放到它才算证明：下面发布的日记或日志文件都可以。",
    reported: "由主人上报",
    reportedNote:
      "其余的状态由主人的游戏在保存当天时写入；链上保存它，但无法核对它。只有记忆位能被证明，方法是下面的日志核对。",
    run: "比对它电路的 32 个随机步骤",
    running: "正在询问处理器……",
    match: "一致",
    differ: "不一致",
    allOk:
      "{n} 个步骤全部一致：在它保存的记忆和 31 个随机记忆下，各配一个随机输入，X Layer 上的处理器和开源求值器给出相同的下一份记忆和输出。",
    someBad: "有 {n} 个步骤不一致。请报告，这不应该发生。",
    comparing: "已比对 {k} / 32……",
    bitOrder: "记忆，第 0 位在前",
    logNotLog: "这个文件不是灵犀的日志：没法按日志读出来。",
    logUnread: "暂时没能读到 X Layer，这次核对没法完成。请稍后再试。",
    logTitle: "核对某一天的日志",
    logPick: "选择日志文件",
    logNone: "还没有选择文件",
    logHelp: "拖入游戏导出的日志文件（宠物 → 下载日志）。我们会重算哈希链并重放每一拍。",
    logOk:
      "日志哈希与链上一致，它用到的每个大脑都锚定在这只宠物在 X Layer 上的事件（{a}），重放 {n} 拍后得到的记忆与保存的完全相同。",
    notAnchored: "日志哈希一致，但它用到的大脑无法锚定到这只宠物在 X Layer 上的事件：{why}",
    logBadHash: "这份日志的哈希和链上的不一致。",
    logBadState: "哈希一致，但重放后的记忆与保存的不同。",
    logFromBirth:
      "这份日志从宠物在浏览器里出生时记起，早于它上链：灵犀在 11 月 20 日之前都是这样上链的。从每只新宠物都有的初始记忆重放，这 {n} 拍正好得到保存的记忆；但 X Layer 没有记录这个初始记忆，所以这不是锚定在链上的证明。",
    notFound: "没有这个编号的宠物。",
    tooBig: "这只宠物在 X Layer 上的大脑每一拍要跑 {n} 个门，超过任何宠物心智的上限（{max} 个），所以本页不会运行它。",
    circuitUnread: "暂时没能从 X Layer 读到它的电路，请稍后再试。",
    picture: "它的样子，由链上绘制",
    pictureNote: "PetLook 根据宠物保存的状态画出这张图：成长阶段、心情，以及电路有没有亮。本页只是显示链上返回的结果。",
    pictureSame: "与游戏里这个状态的画面逐像素一致。",
    pictureDiff: "这张图和游戏里这个状态的画面不一致。",
    unsaved:
      "由 #{a} 和 #{b} 在 X Layer 上生下，它的第一天还没保存：链上只有繁育合约为它混合好的记忆，所以在主人保存一天之前，PetLook 会把它画成一颗蛋，各项数值都显示 0。这些 0 并不是它的状态。",
    lineMismatch:
      "PetRegistry 把这只宠物记为{recorded}品种，但它保存的状态是{state}品种的，它的样子和想法都按这个来。它出生时就是这样；游戏现在已经不会再写出这样的宠物，下面的核对不受影响。",
    lines: ["温柔", "勇敢", "好奇"],
    otherStarter:
      "这是{starter}品种的初始大脑，而 PetRegistry 把这只宠物记为{line}品种：这是 11 月 15 日的一次测试孵化，那时游戏还没有核对宠物的品种和大脑是否相配。链上记录的就是这样，下面每一项核对读取的都是链上所存的内容。",
    named: "链上名字",
    notDeployed: "这个版本没有连接到部署。",
    want: "想要",
    inputs: "输入",
    state: "记忆",
  },
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** why a log's brains could not be anchored, in plain words */
export const WHY = {
  en: {
    noHints: "no hatching transaction was found to read",
    noHatch: "the transaction named is not this pet's hatching",
    hatchBrain: "the log starts with a brain the pet did not hatch with",
    unanchored: "a brain it names has no matching event for this pet",
    skipsChange: "it leaves out a brain the pet held",
    notCurrent: "it does not end with the pet's brain on record",
  },
  zh: {
    noHints: "找不到它孵化的交易",
    noHatch: "给出的交易不是这只宠物的孵化",
    hatchBrain: "日志开头的大脑不是它孵化时的大脑",
    unanchored: "日志用到的某个大脑在链上没有这只宠物对应的事件",
    skipsChange: "日志漏掉了它用过的一个大脑",
    notCurrent: "日志结尾的大脑不是它现在记录在链上的大脑",
  },
} as const;

/** who answered a check: the public endpoints, with a fallback marked */
export const viaText = (hosts: ReadonlySet<string>, lang: "en" | "zh") =>
  hosts.size ? `${lang === "zh" ? "回答者：" : "Answered by "}${[...hosts].join(", ")}` : "";
