/**
 * Runs Lingxi on one machine: the game server (site, API, live rooms, brain
 * relayer on X Layer mainnet), the Cloudflare tunnel that gives it its public
 * address, a watchdog that restarts either when it stops answering, and the daily
 * backup of the server's data. Secrets are read from files
 * outside the repo; none are written here.
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
      // P3b: the built server (pnpm server:release builds it and reloads this): it starts in about half a second on
      // 165 MB, where transpiling it through tsx took about 3 s and 390 MB, and minutes on a machine short of memory
      script: path.join(root, "services", "api", "dist", "server.mjs"),
      interpreter: "node",
      env: {
        PORT: "8790",
        // the site's releases (A10): `pnpm site:release` makes each live by replacing apps/web/site/current.json
        LINGXI_SITE: "../../apps/web/site",
        LINGXI_ORIGINS: "https://lingxi.knole.me",
        // R17: this server writes each start in the restart ledger, where the release command and the watchdog write
        // their restarts (deploy/noteRestart.mjs keeps the same file by default)
        LINGXI_RESTART_LEDGER: path.join(os.homedir(), "lingxi-restarts.log"),
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
        // who opened each red packet, indexed from the contract's events (A1)
        LINGXI_PACKETS_STORE: path.join(root, "services", "api", "data", "red-packet-claims.json"),
        // every breeding consent on both breeders, from the registry's block (A63)
        LINGXI_CONSENTS_STORE: path.join(root, "services", "api", "data", "consents.json"),
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
        // signs every TAP-13 answer of the agent API; holds no funds (scripts/tap-manifest.mts)
        LINGXI_TAP_KEY_FILE: path.join(secrets, "tap-signer.env"),
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
    {
      // every minute: restarts a hung server or a stale tunnel (deploy/watchdog.mjs)
      name: "lingxi-watchdog",
      cwd: root,
      script: path.join(root, "deploy", "watchdog.mjs"),
      restart_delay: 10_000,
    },
    {
      // once a day: the data folder to a dated copy and to Google Drive, checked (deploy/backup.mjs)
      name: "lingxi-backup",
      cwd: root,
      script: path.join(root, "deploy", "backup.mjs"),
      cron_restart: "30 3 * * *",
      autorestart: false,
    },
  ],
};
