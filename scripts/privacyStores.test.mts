/**
 * R6: the privacy page names everything the server keeps. Each store the server writes is mapped here to the words
 * the page uses for it, in English and Chinese, and the page must carry them. A store the server opens that this map
 * does not name fails, so a new one cannot be added without the page saying so. On this PC the live data folder is
 * checked too: every file and folder in it must be one the map names.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const page = readFileSync(join(root, "apps", "web", "src", "info", "InfoApp.tsx"), "utf8");

/** Each store's name in the data folder (without .bak, .d or .migrated), and the page's words for it. */
const NAMED: Record<string, [string, string]> = {
  "home-decor": ["Your pet's home, as you decorate it", "你布置的宠物的家"],
  homes: ["Wallets you link to your home", "关联到家里的钱包"],
  sitting: ["A pet you leave with a sitter", "你托付给别人照看的宠物"],
  arena: ["Pets you enter in the arena or the weekly season", "你送去竞技场或每周赛季的宠物"],
  season: ["Pets you enter in the arena or the weekly season", "你送去竞技场或每周赛季的宠物"],
  standings: ["Pets you enter in the arena or the weekly season", "你送去竞技场或每周赛季的宠物"],
  library: ["Lessons you choose to share in the library", "你选择分享到课程库的课"],
  diaries: ["diaries you choose to publish", "你选择发布的日记"],
  "adoption-papers": ["Adoption papers", "领养资料"],
  duels: ["Short duel links you make", "你生成的短切磋链接"],
  agents: ["Pets raised by AI agents through our agent API", "AI 智能体通过我们的智能体接口养的宠物"],
  sponsored: ["If Lingxi keeps your pet on X Layer for you", "如果灵犀替你把宠物留在 X Layer 上"],
  "relay-quota": ["How many new minds each pet and wallet has asked Lingxi to tape out", "请灵犀流片新心智的次数"],
  "push-subscriptions": ["If you turn reminders on", "如果你打开提醒"],
  "model-budget": ["how much of the day's language model it may use", "能用掉当天多少语言模型额度"],
  "ip-key": ["a key only our server holds and never copies off it", "只有我们服务器才有、也从不拷贝出去的密钥"],
  // copies of what anyone can read on X Layer, and the team's own wallets
  ...Object.fromEntries(
    [
      "brains",
      "brains-xlayer",
      "circuits",
      "consents",
      "daily",
      "goals-xlayer",
      "history-xlayer",
      "lane",
      "market-v1",
      "packets",
      "red-packet-claims",
      "refs",
      "sales-xlayer",
      "team",
    ].map((k) => [k, ["Copies of what anyone can read on X Layer", "任何人都能在 X Layer 上读到的内容的副本"]]),
  ),
};

/** The stores the server's code opens by name: its LINGXI_*_STORE / *_DIR / *_FILE settings and their defaults. */
const ENV_STORES: Record<string, string> = {
  LINGXI_AGENT_STORE: "agents",
  LINGXI_ARENA_STORE: "arena",
  LINGXI_BRAIN_STORE: "brains",
  LINGXI_CIRCUITS_STORE: "circuits",
  LINGXI_CONSENTS_STORE: "consents",
  LINGXI_DECOR_STORE: "home-decor",
  LINGXI_DIARY_DIR: "diaries",
  LINGXI_DUELS_DIR: "duels",
  LINGXI_GOALS_STORE: "goals-xlayer",
  LINGXI_HISTORY_STORE: "history-xlayer",
  LINGXI_HOMES_STORE: "homes",
  LINGXI_LIBRARY_STORE: "library",
  LINGXI_PACKETS_STORE: "packets",
  LINGXI_PAPERS_STORE: "adoption-papers",
  LINGXI_REFS_STORE: "refs",
  LINGXI_SALES_STORE: "sales-xlayer",
  LINGXI_SEASON_STORE: "season",
  LINGXI_SIT_STORE: "sitting",
  LINGXI_SPONSOR_STORE: "sponsored",
  LINGXI_RELAY_QUOTA_FILE: "relay-quota",
  LINGXI_IP_KEY_FILE: "ip-key",
  LINGXI_DAILY_FILE: "daily",
  LINGXI_LANE_FILE: "lane",
  LINGXI_TEAM_FILE: "team",
  LINGXI_MARKET_V1_STORE: "market-v1",
  LINGXI_STANDINGS_FILE: "standings",
  LINGXI_PUSH_STORE: "push-subscriptions",
};

/** Settings that are not data about players, each with why: the server's own signing keys, kept under .secrets. */
const NOT_PLAYER_DATA: Record<string, string> = {
  LINGXI_TAP_KEY_FILE: "the key the server signs TAP answers with",
  LINGXI_VOUCHER_KEY_FILE: "the key the server signs keepsake vouchers with",
  LINGXI_PUSH_KEY_FILE: "the key the server signs reminders with",
  LINGXI_RELAYER_KEY_FILE: "the relayer's wallet key",
  LINGXI_MAIL_FILE: "the game's letters, shipped with the server",
  LINGXI_DATA_DIR: "the folder the stores sit in",
  LINGXI_BACKUP_DIR: "where backups go",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(n) ? [p] : [];
  });
}

describe("the privacy page names everything the server keeps (R6)", () => {
  it("each store's words are on the page, in English and Chinese", () => {
    const missing = Object.entries(NAMED).flatMap(([k, [en, zh]]) =>
      [en, zh].filter((w) => !page.includes(w)).map((w) => `${k}: ${w}`),
    );
    expect(missing).toEqual([]);
  });

  it("every store setting the server reads is one the page names", () => {
    const code = sources(join(root, "services", "api", "src"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const settings = [...new Set(code.match(/LINGXI_[A-Z0-9_]+_(STORE|DIR|FILE)\b/g) ?? [])].filter(
      (s) => !NOT_PLAYER_DATA[s],
    );
    const unnamed = settings.filter((s) => !ENV_STORES[s] || !NAMED[ENV_STORES[s]]);
    expect(unnamed).toEqual([]);
  });

  const data = join(root, "services", "api", "data");
  it.runIf(existsSync(data))("every file in the server's data folder on this PC is one the page names", () => {
    const base = (n: string) =>
      n
        .replace(/\.(bak|migrated)$/, "")
        .replace(/\.d$/, "")
        .replace(/\.json$/, "");
    const unnamed = readdirSync(data)
      .map(base)
      .filter((n) => !NAMED[n]);
    expect([...new Set(unnamed)]).toEqual([]);
  });
});
