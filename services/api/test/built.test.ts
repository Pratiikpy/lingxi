/**
 * P3b: the live server runs from its built bundle (scripts/build-server.mts), so the bundle is held to the source: each
 * built worker, started by the file name the server starts it by, gives the same answers as the source does, and the
 * built server starts and answers with every path it reads from its own file resolved.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it } from "vitest";
import { STARTERS, compileProgram, load, netlistBytes } from "@lingxi/brain";
import { type SeasonEntry, ZERO_HASH, chainAll, parseCard, petCard, seasonStandings } from "@lingxi/game";
import { buildServer } from "../scripts/build-server";

const API = join(import.meta.dirname, "..");
// beside src, as dist is, so the paths the built server resolves from its own file are the ones dist resolves
const OUT = join(API, "dist-test");
const LINES = ["gentle", "bold", "curious"] as const;

/** The first message a built worker sends back. */
function ask<T>(boot: string, init: { workerData?: unknown; post?: unknown }): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(join(OUT, boot), init.workerData === undefined ? {} : { workerData: init.workerData });
    w.once("message", (m: T) => {
      void w.terminate();
      resolve(m);
    });
    w.once("error", reject);
    if (init.post !== undefined) w.postMessage(init.post);
  });
}

describe("the built server answers as the source does (P3b)", () => {
  beforeAll(async () => {
    await buildServer(OUT);
  }, 120_000);

  it("is built with a worker under each boot file name the server starts", () => {
    for (const f of ["server.mjs", "logHashBoot.mjs", "mindBoot.mjs", "standingsBoot.mjs"]) expect(existsSync(join(OUT, f)), f).toBe(true);
  });

  it("the built diary hash worker gives the chain's hash", async () => {
    const words = Uint16Array.from({ length: 2_000 }, (_, i) => (i * 40_503 + 17) & 0xffff);
    const m = await ask<{ id: number; hash: string }>("logHashBoot.mjs", { post: { id: 7, words } });
    expect(m).toEqual({ id: 7, hash: chainAll(ZERO_HASH, [...words]) });
  }, 60_000);

  it("the built mind worker tells the circuit's own mind from a taught one", async () => {
    const circuit = load(netlistBytes(compileProgram(STARTERS.gentle)), 16, 8);
    const card = (lessons: unknown[]) => parseCard(petCard({ line: "gentle", lessons, instincts: 0 } as never))!;
    const same = await ask<{ same?: boolean }>("mindBoot.mjs", { workerData: { circuit, line: "gentle", card: card([]) } });
    const taught = await ask<{ same?: boolean }>("mindBoot.mjs", { workerData: { circuit, line: "gentle", card: card([{ when: { hunger: [3] }, then: { want: 5, mood: 2 } }]) } });
    expect([same.same, taught.same]).toEqual([true, false]);
  }, 60_000);

  it("the built standings worker fights a season as the source does", async () => {
    const entries: SeasonEntry[] = [1, 2, 3].map((i) => ({ key: `k${i}`, pet: { name: `Pet${i}`, line: LINES[i % 3]!, stage: "child", card: petCard({ lessons: [] }), story: { days: 1, lessons: 0, nature: [] } }, at: i }));
    const m = await ask<{ standings?: unknown }>("standingsBoot.mjs", { workerData: { week: "2026-W47", entries } });
    expect(m.standings).toEqual(seasonStandings("2026-W47", entries));
  }, 60_000);

  it("the built server starts on its own and answers, its site and its letters found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lx-built-"));
    const port = 18_000 + Math.floor(Math.random() * 2_000);
    const store = (n: string) => join(dir, n);
    const env = {
      ...process.env,
      PORT: String(port),
      LINGXI_SECRETS: store("none.env"),
      LINGXI_SITE: "../../apps/web/site",
      ...Object.fromEntries(
        ["AGENT_STORE", "ARENA_STORE", "BRAIN_STORE", "DECOR_STORE", "DIARY_DIR", "DUELS_DIR", "HOMES_STORE", "LANE_FILE", "LIBRARY_STORE", "PAPERS_STORE", "PUSH_STORE", "SEASON_STORE", "SIT_STORE", "SPONSOR_STORE", "STANDINGS_FILE", "DAILY_FILE", "PACKETS_STORE", "RELAY_QUOTA_FILE", "CONSENTS_STORE", "MARKET_V1_STORE", "REFS_STORE", "CIRCUITS_STORE", "TEAM_FILE"].map((k) => [`LINGXI_${k}`, store(k.toLowerCase())]),
      ),
    };
    for (const k of ["LINGXI_REGISTRY", "LINGXI_PROCESSOR", "LINGXI_RELAYER_KEY_FILE", "LINGXI_VOUCHER_KEY_FILE", "LINGXI_PUSH_KEY_FILE", "ANTHROPIC_API_KEY"]) delete (env as Record<string, string | undefined>)[k];
    const p = spawn(process.execPath, [join(OUT, "server.mjs")], { cwd: API, env, stdio: "ignore" });
    try {
      let health: Response | null = null;
      for (let i = 0; i < 120 && !health; i++) {
        try {
          health = await fetch(`http://127.0.0.1:${port}/api/health`);
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      expect(health?.status, "it answers").toBe(200);
      const mail = (await (await fetch(`http://127.0.0.1:${port}/api/mail`)).json()) as { letters?: unknown[] };
      expect(mail.letters?.length, "its letters are found beside it (../mail)").toBeGreaterThan(0);
      const page = await fetch(`http://127.0.0.1:${port}/handheld.html`);
      expect(page.status, "its site is found from its folder").toBe(200);
    } finally {
      p.kill();
    }
  }, 120_000);
});
