/**
 * Runs Lingxi on one machine: the game server (site, API, live rooms, brain
 * relayer on X Layer mainnet) and the Cloudflare tunnel that gives it its public
 * address. Secrets are read from files outside the repo; none are written here.
 *
 *   pm2 start deploy/pm2.config.cjs && pm2 save
 */

const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tunnelConfig = process.env.LINGXI_TUNNEL_CONFIG ?? path.join(os.homedir(), ".cloudflared", "lingxi.yml");
const secrets = path.resolve(root, "..", ".secrets");

module.exports = {
  apps: [
    {
      name: "lingxi-server",
      cwd: path.join(root, "services", "api"),
      script: path.join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      args: "src/server.ts",
      interpreter: "node",
      env: {
        PORT: "8790",
        LINGXI_STATIC: "../../apps/web/dist",
        LINGXI_ORIGINS: "https://lingxi.knole.me",
        LINGXI_RELAYER_KEY_FILE: path.join(secrets, "relayer.env"),
        LINGXI_PROCESSOR: "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e",
        LINGXI_RPC: "https://xlayerrpc.okx.com",
        LINGXI_BRAIN_STORE: path.join(root, "services", "api", "data", "brains-xlayer.json"),
        LINGXI_RELAY_PER_DAY: "100",
        LINGXI_PUSH_KEY_FILE: path.join(secrets, "push.env"),
        LINGXI_PUSH_STORE: path.join(root, "services", "api", "data", "push-subscriptions.json"),
        LINGXI_LIBRARY_STORE: path.join(root, "services", "api", "data", "lesson-library.json"),
        LINGXI_DECOR_STORE: path.join(root, "services", "api", "data", "home-decor.json"),
        LINGXI_HOMES_STORE: path.join(root, "services", "api", "data", "home-wallets.json"),
        LINGXI_SIT_STORE: path.join(root, "services", "api", "data", "sitting.json"),
        LINGXI_ARENA_STORE: path.join(root, "services", "api", "data", "arena.json"),
        LINGXI_SEASON_STORE: path.join(root, "services", "api", "data", "season.json"),
        LINGXI_AGENT_STORE: path.join(root, "services", "api", "data", "agents.json"),
        LINGXI_DIARY_DIR: path.join(root, "services", "api", "data", "diaries"),
        LINGXI_LANE_FILE: path.join(root, "services", "api", "data", "lane.json"),
        LINGXI_REGISTRY: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99",
        LINGXI_LOOK: "0x0642a802967260714d4efec05fef701b17d31b75",
        LINGXI_REGISTRY_FROM: "75968151",
        LINGXI_HISTORY_STORE: path.join(root, "services", "api", "data", "history-xlayer.json"),
        LINGXI_MARKET_OKB: "0xb9f6b18edd21933582ec69fb1e718d9629e684cd",
        LINGXI_MARKET_OKB_FROM: "76011196",
        LINGXI_SALES_STORE: path.join(root, "services", "api", "data", "sales-xlayer.json"),
        LINGXI_GOALS_STORE: path.join(root, "services", "api", "data", "goals-xlayer.json"),
        LINGXI_MARKET_BEM: "0xa292c12b0414bbfc14994f93bcff8bd58c921e55",
        LINGXI_MARKET_BEM_FROM: "76063126",
        LINGXI_BREEDER: "0x8da8221466de12321e6ee2ea73d62aaf28bb11b0",
        LINGXI_GIFT: "0xc216a4abb6c4c2d0b485f42219197551330b6cf4",
        LINGXI_ITEM_SHOP: "0xaf8857c0d723e14f60d00fe46120abd0303f52cc",
        LINGXI_VOUCHER_KEY_FILE: path.join(secrets, "voucher.env"),
        LINGXI_ADOPTION: "0x58212451fcd46ff6130cff428f2f4273f4cc7596",
        LINGXI_EXTRAS: "0x560c7dc63a45e5afe53ad156152555a5c067598d",
        LINGXI_PAPERS_STORE: path.join(root, "services", "api", "data", "adoption-papers.json"),
      },
      max_memory_restart: "600M",
      restart_delay: 3000,
    },
    {
      name: "lingxi-tunnel",
      script: "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      args: ["--config", tunnelConfig, "tunnel", "run", "lingxi"],
      interpreter: "none",
      restart_delay: 5000,
    },
  ],
};
