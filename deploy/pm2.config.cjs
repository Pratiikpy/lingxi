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
        LINGXI_RPC: "https://rpc.xlayer.tech",
        LINGXI_BRAIN_STORE: path.join(root, "services", "api", "data", "brains-xlayer.json"),
        LINGXI_RELAY_PER_DAY: "100",
        LINGXI_PUSH_KEY_FILE: path.join(secrets, "push.env"),
        LINGXI_PUSH_STORE: path.join(root, "services", "api", "data", "push-subscriptions.json"),
        LINGXI_LIBRARY_STORE: path.join(root, "services", "api", "data", "lesson-library.json"),
        LINGXI_DECOR_STORE: path.join(root, "services", "api", "data", "home-decor.json"),
        LINGXI_REGISTRY: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99",
        LINGXI_REGISTRY_FROM: "75968151",
        LINGXI_HISTORY_STORE: path.join(root, "services", "api", "data", "history-xlayer.json"),
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
