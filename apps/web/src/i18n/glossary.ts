/**
 * P6: the game's terms, one word each in English and in Chinese. A player who meets the same thing under two names
 * thinks they are two things; glossary.test.ts fails when any shown text uses a word this list rules out. Where a
 * Chinese word has another, unrelated meaning the game also uses (托管 is the red packet's escrow), only the phrasing
 * that means this term is ruled out.
 */

export interface Term {
  en: string;
  zh: string;
  /** what the term means here, so a new string can pick the right word */
  means: string;
  /** Chinese renderings of this term the game does not use */
  notZh?: readonly RegExp[];
  /** English renderings of this term the game does not use */
  notEn?: readonly RegExp[];
}

export const GLOSSARY: readonly Term[] = [
  { en: "pet", zh: "宠物", means: "the creature a player raises" },
  { en: "mind", zh: "心智", means: "everything a pet has learned, as the circuit that decides what it does" },
  { en: "brain", zh: "大脑", means: "the circuit itself, as gates and latches; a pet's mind runs on its brain" },
  { en: "circuit", zh: "电路", means: "a netlist of NAND gates and latches", notZh: [/线路/] },
  { en: "NAND gate", zh: "与非门", means: "the one kind of gate every circuit is made of", notZh: [/逻辑门/] },
  { en: "lesson", zh: "课", means: "one rule a player teaches, in their own words", notZh: [/教程/] },
  { en: "instinct", zh: "本能", means: "a rule a pet is born with or adopts", notZh: [/天性/, /直觉/] },
  {
    en: "tape out (verb), tape-out (noun)",
    zh: "流片",
    means: "turning a circuit into a TapeOut token on X Layer",
    notZh: [/刻录/],
  },
  {
    en: "keep on X Layer",
    zh: "留在 X Layer 上",
    means: "a pet given its own record on X Layer, so its mind is taped out and its days can be saved",
    notZh: [/放到链上/],
  },
  { en: "save a day", zh: "存到 X Layer 上", means: "writing one day of a kept pet's memory to X Layer" },
  { en: "spar", zh: "切磋", means: "a friendly fight between two pets' circuits", notZh: [/对练/, /比试/] },
  { en: "arena", zh: "竞技场", means: "the run of fights against other players' pets", notZh: [/切磋场/, /擂台/] },
  { en: "season", zh: "赛季", means: "the weekly standings", notZh: [/季赛/] },
  {
    en: "sitter",
    zh: "照看",
    means: "a friend who looks after a pet while its owner is away",
    notZh: [/托管(?:的)?宠物/, /寄养/],
  },
  { en: "diary", zh: "日记", means: "a pet's own account of its day", notZh: [/手记/] },
  { en: "resident", zh: "居民", means: "one of the world's characters who live in its rooms", notZh: [/住户/] },
  {
    en: "Builders' Lane",
    zh: "建设者小巷",
    means: "the lane of five pets made as tributes to TapeOut builders",
    notZh: [/建造者小巷/, /建设者之巷/, /开发者小巷/, /建设者街/],
    notEn: [/Builders Lane/, /Builder's Lane/],
  },
  { en: "handheld", zh: "掌机", means: "the pocket device that runs a pet's circuit", notZh: [/掌上灵犀/, /掌上设备/] },
  {
    en: "verify",
    zh: "验证",
    means: "proving something against X Layer or a published source (the proof page, a contract's source)",
    notZh: [/核验/],
  },
  { en: "check", zh: "核对", means: "comparing two things to see they agree (a pet against its record)" },
  { en: "outfit", zh: "衣服", means: "something a pet wears; the market for them is the fashion market, 时装市场" },
];
