/**
 * The note on every page names everything the game reads from Lingxi's server (A95). Every server route the web client
 * calls is read from its source, and each must be named in the note's server list, in English and in Chinese, by the
 * words this table gives it; a route the game starts to read that the note does not name fails.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const web = join(root, "apps", "web", "src");

/** Each route family (the path's first part after /api/) and how the note names it, in English and Chinese. */
const NAMED: Record<string, [string, string]> = {
  time: ["the time", "时间"],
  mail: ["mail", "邮件"],
  health: ["whether it is up", "它是否在线"],
  season: ["the weekly season", "每周赛季"],
  arena: ["arena opponents", "竞技场对手"],
  v1: ["sparring partners", "陪练"],
  duels: ["duel links", "切磋链接"],
  lessons: ["lessons from the library", "课程库里的课"],
  sit: ["a pet left with a friend", "托朋友照看的宠物"],
  papers: ["adoption papers", "领养文书"],
  pets: ["published diaries and each pet's history", "发布的日记和每只宠物的经历"],
  consents: ["breeding consents", "繁育同意"],
  packets: ["red-packet claims", "红包领取记录"],
  voucher: ["item vouchers", "道具兑换券"],
  market: ["retired market listings", "下架的市场挂单"],
  sourcify: ["Sourcify's verdicts", "Sourcify 对合约的核验结果"],
  daily: ["the daily challenge's block", "每日挑战区块"],
  tree: ["the family tree", "家族树"],
  lane: ["Builders' Lane's tape-out count", "建设者小巷的流片计数"],
  goals: ["goals", "目标"],
  numbers: ["the numbers", "各项数字"],
  // what the player sends, and the forwarded chain reads, are named on the note's other lines
  rpc: ["The game's reads of X Layer", "游戏对 X Layer 的读取"],
  move: ["a save moved to another device", "搬到另一台设备的存档"],
  push: ["reminders", "提醒"],
  teach: ["Teaching in plain words", "用自己的话教它"],
  voice: ["spoken lines", "宠物说的话"],
  tapeout: ["new minds for Lingxi to tape out", "请灵犀流片的新心智"],
  "tapeout-child": ["new minds for Lingxi to tape out", "请灵犀流片的新心智"],
  "tapeout-instinct": ["new minds for Lingxi to tape out", "请灵犀流片的新心智"],
  sponsor: ["keep your pet on X Layer for you", "替你把宠物留在链上"],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

/** The route families the web client calls. */
function routes(): Set<string> {
  const found = new Set<string>();
  // a route, never a path such as services/api/src in a comment
  for (const f of files(web)) for (const m of readFileSync(f, "utf8").matchAll(/(?<![a-z])\/api\/([a-z][a-z0-9-]*)/g)) found.add(m[1]!);
  return found;
}

describe("the note names everything the game reads from the server (A95)", () => {
  it("every route the client calls has a name in the note, in both languages", () => {
    const note = readFileSync(join(web, "OnChainNote.tsx"), "utf8");
    const called = routes();
    expect(called.size, "the client's routes were read").toBeGreaterThan(15);
    for (const r of called) {
      const named = NAMED[r];
      expect(named, `the route /api/${r} has a name in the note`).toBeDefined();
      expect(note, `/api/${r}: "${named![0]}"`).toContain(named![0]);
      expect(note, `/api/${r}: "${named![1]}"`).toContain(named![1]);
    }
  });
});
