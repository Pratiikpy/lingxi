/**
 * `pnpm claims:check`: every row of docs/claims.md has a check, and every automatic check passes against X Layer
 * mainnet and the live site. Tests, README facts and the judge check are run elsewhere (`pnpm test`, `forge test`,
 * `readme-facts`, `judge:check`); here they are only confirmed to exist, so no row points at nothing.
 *
 *   pnpm claims:check [--list]
 */

import { type RunDeps, judgeVerdict, runTest } from "./lib/claimsRun.mts";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Address, type Hex, type PublicClient, createPublicClient, encodeFunctionData, http, keccak256 } from "viem";
import { STARTERS, compileProgram, compileSeal, gateCount, stateBits } from "../packages/brain/src/index.ts";
import { EVOLUTION } from "../packages/game/src/index.ts";
import { STAGE_DAYS } from "../packages/game/src/pet.ts";
import {
  type Deployment,
  RULES,
  breederV2Abi,
  adoptionCentreAbi,
  checkRules,
  currentMarket,
  outfitMarketAbi,
  outfitMarketV2Abi,
  itemShopAbi,
  petRegistryAbi,
  processorAbi,
  readDesign,
  readExtras,
  rulesVerdict,
  xLayer,
} from "../packages/chain/src/index.ts";

import { retryNote, steadyFetch } from "./lib/steadyFetch.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.env.LINGXI_LIVE_URL ?? "https://lingxi.knole.me";
const d = JSON.parse(readFileSync(join(root, "packages/chain/deployments/xlayer.json"), "utf8")) as Deployment & Record<string, unknown>;
const pub = createPublicClient({ chain: xLayer, transport: http("https://xlayerrpc.okx.com", { timeout: 20_000, retryCount: 3 }) }) as PublicClient;

const BEM = (n: number) => BigInt(Math.round(n * 1e8));
const BURN = "0x000000000000000000000000000000000000dEaD";
const PROJECT = (d.deployer as string | undefined) ?? "0xA551feD6f2Ab35d509A71B74D5E9F38742E0aaD8";
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const read = (address: unknown, abi: readonly unknown[], functionName: string, args: unknown[] = []) => pub.readContract({ address: address as Address, abi: abi as never, functionName: functionName as never, args: args as never }) as Promise<unknown>;

type Check = () => Promise<string>;
const fail = (why: string): never => {
  throw new Error(why);
};
const expect = (ok: boolean, why: string) => ok || fail(why);

/** The README's table of core circuit hashes. */
const CORE: Record<number, Hex> = {
  1: "0xab2d7b0e5c8eeb1fcdf6f0225b6dd912459a26b6fcc73f86d5470152a18a1e47",
  2: "0x085d9b6352bf1cd5f06061c948f48787db58469454558f627a198569d55b24cd",
  3: "0x372b08dab3d43d9d14e0f4c8884c8063d978264abbc1fe4261c8d25eb8064a7a",
  4: "0x9dfb688b75b94a700690c28f34e978a0ef8bc2f2d5be621317f4d1f8fd8fc7d0",
  5: "0x0d031b05b1928278eab4b2b82ecf15354990dc45311eedeaa1ea915a93687cb1",
};
/** The eleven contracts the README lists, by deployment key. */
const CONTRACTS = ["registry", "breeder", "adoptionCentre", "outfitMarketV2", "itemShop", "extras", "holderGift", "look", "redPacket", "outfitMarket", "breederFree"];

const AUTO: Record<string, Check> = {
  "fees-markets": async () => {
    const [v1fee, v1to] = await Promise.all([read(d.outfitMarket, outfitMarketAbi, "feeBps"), read(d.outfitMarket, outfitMarketAbi, "treasury")]);
    const [v2fee, v2burn] = await Promise.all([read(d.outfitMarketV2, outfitMarketV2Abi, "feeBps"), read(d.outfitMarketV2, outfitMarketV2Abi, "BURN")]);
    expect(Number(v1fee) === 300 && same(v1to, PROJECT), `first market: fee ${v1fee} bps to ${v1to}`);
    expect(Number(v2fee) === 300 && same(v2burn, BURN), `BEM market: fee ${v2fee} bps to ${v2burn}`);
    return "OKB market 3% to the project wallet; BEM market 3% to the burn address";
  },
  "fees-breed": async () => {
    const [fee, burn] = await Promise.all([read(d.breeder, breederV2Abi, "breedFee"), read(d.breeder, breederV2Abi, "BURN")]);
    expect(fee === BEM(0.1) && same(burn, BURN), `breed fee ${fee} to ${burn}`);
    return "0.1 BEM to the burn address";
  },
  "fees-adopt": async () => {
    const [fee, co, min, max, burn] = await Promise.all(["feeBps", "COPARENT_BPS", "MIN_PRICE", "MAX_PRICE", "BURN"].map((f) => read(d.adoptionCentre, adoptionCentreAbi, f)));
    expect(Number(fee) === 300 && Number(co) === 1000 && min === BEM(0.01) && max === BEM(100) && same(burn, BURN), `fee ${fee}, co-parent ${co}, range ${min}..${max}`);
    return "3% burned, 10% to the co-parent, 0.01 to 100 BEM";
  },
  "fees-items": async () => {
    const m = currentMarket(d) ?? fail("no BEM market");
    const items = d.items as Record<string, string>;
    for (const key of ["star-lamp", "circuit-rug", "tape-shelf", "moon-window"]) {
      const id = BigInt(items[key]!);
      // sold by the item shop at its own price (the whole price burned), as copies of a design capped on the market
      const [price, burn, x] = await Promise.all([read(d.itemShop, itemShopAbi, "price", [id]), read(d.itemShop, itemShopAbi, "BURN"), readDesign(pub, m, id)]);
      expect(price === BEM(0.05) && same(burn, BURN) && x.maxSupply === 500, `${key}: ${price} to ${burn}, ${x.maxSupply} copies`);
    }
    return "four decorations, 0.05 BEM each, 500 copies";
  },
  "fees-limited": async () => {
    const m = currentMarket(d) ?? fail("no BEM market");
    const items = d.items as Record<string, string>;
    for (const key of ["nand-crown", "probe-visor", "wafer-wand"]) {
      const id = BigInt(items[key]!);
      const [price, x] = await Promise.all([read(d.itemShop, itemShopAbi, "price", [id]), readDesign(pub, m, id)]);
      expect(price === BEM(0.1) && x.maxSupply === 300, `${key}: ${price}, ${x.maxSupply} copies`);
    }
    return "three outfits, 0.1 BEM each, 300 copies each";
  },
  "fees-extras": async () => {
    const t = await readExtras(pub, d, BURN);
    expect(t.price.room === BEM(0.05) && t.price.looks === BEM(0.05) && t.price.colour === BEM(0.05), `prices ${JSON.stringify(t.price, (_, v) => (typeof v === "bigint" ? String(v) : v))}`);
    return "room, looks and colour at 0.05 BEM each";
  },
  "holder-gift": async () => {
    const abi = ["test1", "rig", "bemMin", "fabMin", "outfit"].map((name) => ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: name.endsWith("Min") || name === "outfit" ? "uint256" : "address" }] }));
    const [test1, rig, bemMin, fabMin, outfit] = await Promise.all(["test1", "rig", "bemMin", "fabMin", "outfit"].map((f) => read(d.holderGift, abi, f)));
    const zero = "0x0000000000000000000000000000000000000000";
    expect(!same(test1, zero) && !same(rig, zero) && (bemMin as bigint) > 0n && (fabMin as bigint) > 0n && (outfit as bigint) > 0n, `test1 ${test1}, rig ${rig}, bem ${bemMin}, fab ${fabMin}, outfit ${outfit}`);
    const payable = (await import("../packages/chain/src/holderGiftAbi.ts")).holderGiftAbi.filter((x: { type: string; stateMutability?: string }) => x.type === "function" && x.stateMutability === "payable");
    expect(payable.length === 0, "the gift contract takes payment");
    // BEM and FAB are a snapshot at a fixed block, not live balances (A58)
    const snap = [{ type: "function", name: "snapshotBlock", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;
    const block = (await read(d.holderGift, snap, "snapshotBlock")) as bigint;
    expect(block === 76_052_000n, `the snapshot block is ${block}`);
    return `Test1 and Rig by token, BEM and FAB by the snapshot at block ${block}; no payable function`;
  },
  "no-bem-held": async () => {
    const bem = (await read(d.breeder, breederV2Abi, "bem")) as Address;
    const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
    const held: string[] = [];
    for (const k of CONTRACTS) {
      const a = d[k];
      if (typeof a !== "string") continue;
      const b = (await read(bem, erc20, "balanceOf", [a])) as bigint;
      if (b > 0n) held.push(`${k} ${b}`);
    }
    // the BEM market owes creators and sellers until they withdraw; nothing else may hold BEM
    const owed = (await read(d.outfitMarketV2, outfitMarketV2Abi, "totalOwed")) as bigint;
    const market = held.find((h) => h.startsWith("outfitMarketV2"));
    const others = held.filter((h) => !h.startsWith("outfitMarketV2"));
    expect(!others.length, `holding BEM: ${others.join(", ")}`);
    expect(!market || BigInt(market.split(" ")[1]!) <= owed, `the BEM market holds more than it owes (${market}, owed ${owed})`);
    // OKB: only the first market, and exactly what it owes the project's treasury (its 3% fee, until withdrawn) (A46)
    const okb: string[] = [];
    for (const k of CONTRACTS) {
      const a = d[k];
      if (typeof a !== "string") continue;
      const b = await pub.getBalance({ address: a as Address });
      if (b > 0n) okb.push(`${k} ${b}`);
    }
    const okbOthers = okb.filter((h) => !h.startsWith("outfitMarket "));
    expect(!okbOthers.length, `holding OKB: ${okbOthers.join(", ")}`);
    const v1 = await pub.getBalance({ address: d.outfitMarket as Address });
    const treasury = (await read(d.outfitMarket, outfitMarketAbi, "treasury")) as Address;
    const owedProject = (await read(d.outfitMarket, outfitMarketAbi, "owed", [treasury])) as bigint;
    expect(v1 === owedProject, `the first market holds ${v1} wei of OKB but owes the project ${owedProject}`);
    return `BEM only in the second market, ${market ? market.split(" ")[1] : "0"} of ${owed} owed; OKB only in the first, ${v1} wei, all owed to the project`;
  },
  "two-step-owners": async () => {
    // an owned contract answers owner(); a two-step one also answers pendingOwner() (A47)
    const abi = [
      { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
      { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    ] as const;
    const answers = async (a: Address, fn: "owner" | "pendingOwner") => pub.readContract({ address: a, abi, functionName: fn }).then(() => true, () => false);
    const two: string[] = [];
    const one: string[] = [];
    for (const k of CONTRACTS) {
      const a = d[k];
      if (typeof a !== "string" || !(await answers(a as Address, "owner"))) continue;
      ((await answers(a as Address, "pendingOwner")) ? two : one).push(k);
    }
    expect(one.length === 1 && one[0] === "outfitMarket", `one-step ownership: ${one.join(", ") || "none"}`);
    return `two-step: ${two.join(", ")}; one-step: outfitMarket`;
  },
  "circuit-hashes": async () => {
    for (const [id, hash] of Object.entries(CORE)) {
      const nl = (await read(d.processor, processorAbi, "netlist", [BigInt(id)])) as Hex;
      expect(keccak256(nl) === hash, `circuit #${id} hashes to ${keccak256(nl)}`);
    }
    return "all five match";
  },
  rules: async () => {
    const checks = await checkRules(pub, d.processor as Address, d.rules as never);
    expect(rulesVerdict(checks) === "verified" && checks.length === RULES.length && RULES.length === 17, `${checks.filter((c) => c.status !== "match").map((c) => `${c.name} ${c.status}`).join(", ")}`);
    return `${checks.length} of ${RULES.length} match`;
  },
  "circuit-table": async () => {
    // the README's circuit table: gates (TAP-02 counts memory latches as gates) and memory bits of each core circuit,
    // compiled by this repo, which the judge check proves is byte for byte what is on chain (A56)
    const want: Record<string, [number, number]> = { gentle: [296, 8], bold: [233, 8], curious: [248, 8], evolution: [58, 0], seal: [251, 0] };
    const got: Record<string, [number, number]> = {
      gentle: [gateCount(compileProgram(STARTERS.gentle)), stateBits(STARTERS.gentle)],
      bold: [gateCount(compileProgram(STARTERS.bold)), stateBits(STARTERS.bold)],
      curious: [gateCount(compileProgram(STARTERS.curious)), stateBits(STARTERS.curious)],
      evolution: [gateCount(compileProgram(EVOLUTION)), stateBits(EVOLUTION)],
      seal: [gateCount(compileSeal()), 0],
    };
    const off = Object.keys(want).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    expect(!off.length, off.map((k) => `${k} ${got[k]!.join("/")}`).join(", "));
    return Object.entries(got).map(([k, [g, b]]) => `${k} ${g}/${b}`).join(", ");
  },
  "royalty-cap": async () => {
    const abi = [{ type: "function", name: "MAX_ROYALTY_BPS", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] }] as const;
    const cap = Number(await read(d.outfitMarketV2, abi, "MAX_ROYALTY_BPS"));
    expect(cap === 1000, `the market's royalty cap is ${cap} bps`);
    return "royalties capped at 10% on chain";
  },
  // read through pet #1 (A88): its brain circuit, that circuit's holder against pet #1's owner, and that circuit's
  // container, opened; any of them changing fails the claim
  "home-container": async () => {
    const opener = [
      { type: "function", name: "accountOf", stateMutability: "view", inputs: [{ name: "c", type: "address" }, { name: "t", type: "uint256" }], outputs: [{ type: "address" }] },
      { type: "function", name: "isDeployed", stateMutability: "view", inputs: [{ name: "c", type: "address" }, { name: "t", type: "uint256" }], outputs: [{ type: "bool" }] },
    ] as const;
    const ownerAbi = [{ type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
    const pet = (await read(d.registry, petRegistryAbi, "pet", [1n])) as { brainId: bigint | number };
    const brainId = BigInt(pet.brainId);
    const petOwner = (await read(d.registry, ownerAbi, "ownerOf", [1n])) as Address;
    const holder = (await read(d.processor, ownerAbi, "ownerOf", [brainId])) as Address;
    const container = (await read("0x536adD8F30f03b69f6fbF29d425A816A0dC50106", opener, "accountOf", [d.processor, brainId])) as Address;
    const opened = (await read("0x536adD8F30f03b69f6fbF29d425A816A0dC50106", opener, "isDeployed", [d.processor, brainId])) as boolean;
    expect(brainId === 1n, `pet #1 thinks with circuit #${brainId}, not #1`);
    expect(holder.toLowerCase() === petOwner.toLowerCase(), `circuit #${brainId} is held by ${holder}, pet #1 by ${petOwner}: it is not pet #1's home`);
    expect(container.toLowerCase() === "0x31b025ad4cbd4142007f59684d51cd1f2ccc5098", `circuit #${brainId}'s container is ${container}`);
    expect(opened, `container ${container} is not opened`);
    return `pet #1 thinks with circuit #${brainId}, held by its owner; its home is container ${container}, opened`;
  },
  "starter-brain": async () => {
    const n = compileProgram(STARTERS.gentle);
    // TAP-02 counts memory latches as gates, as the processor and the proof table do
    const gates = gateCount(n);
    const bits = stateBits(STARTERS.gentle);
    expect(gates === 296 && bits === 8, `${gates} gates, ${bits} bits`);
    return "296 gates, 8 memory bits";
  },
  "replay-gas": async () => {
    const data = encodeFunctionData({ abi: petRegistryAbi, functionName: "replayStep" as never, args: [1n, 0n, 0] as never });
    const gas = await pub.estimateGas({ to: d.registry as Address, data });
    // the landing says "about 760,000"; within 8% either way still reads as that
    expect(gas > 700_000n && gas < 820_000n, `${gas} gas`);
    return `${gas} gas`;
  },
  "save-cost": async () => {
    const gasPrice = await pub.getGasPrice();
    // the gas the real mainnet saves used, read from each save's own receipt (the server's index names the
    // transactions; their gas comes from the chain) (A56); a cent is far above this at any OKB price under $10,000
    const used: bigint[] = [];
    for (const id of [1, 2, 3]) {
      const h = (await (await steadyFetch(`${LIVE}/api/pets/${id}/history`)).res.json()) as { saves?: Array<{ tx: Hex }> };
      for (const s of h.saves ?? []) used.push((await pub.getTransactionReceipt({ hash: s.tx })).gasUsed);
    }
    expect(used.length > 0, "no mainnet save found to measure");
    const most = used.reduce((a, b) => (b > a ? b : a));
    const cost = most * gasPrice;
    expect(cost < 10n ** 14n, `a save costs ${cost} wei at ${gasPrice} wei/gas`);
    return `the costliest of ${used.length} mainnet saves used ${most} gas: ${Number(cost) / 1e18} OKB at today's gas price`;
  },
  sourcify: async () => {
    const out: string[] = [];
    for (const k of CONTRACTS) {
      const r = await fetch(`https://sourcify.dev/server/v2/contract/196/${d[k] as string}`, { signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { creationMatch?: string; runtimeMatch?: string };
      if (j.creationMatch !== "exact_match" || j.runtimeMatch !== "exact_match") out.push(`${k}: ${j.creationMatch}/${j.runtimeMatch}`);
    }
    expect(!out.length, out.join(", "));
    return `all ${CONTRACTS.length} exact`;
  },
  growth: async () => {
    expect(STAGE_DAYS.adult === 8 && STAGE_DAYS.child === 2 && STAGE_DAYS.teen === 4, JSON.stringify(STAGE_DAYS));
    return "adult on day 8";
  },
  deweb: async () => {
    const domains = [{ type: "function", name: "isLive", stateMutability: "view", inputs: [{ name: "n", type: "string" }, { name: "c", type: "address" }], outputs: [{ type: "bool" }] }] as const;
    const opener = [{ type: "function", name: "accountOf", stateMutability: "view", inputs: [{ name: "c", type: "address" }, { name: "t", type: "uint256" }], outputs: [{ type: "address" }] }] as const;
    const container = (await read("0x536adD8F30f03b69f6fbF29d425A816A0dC50106", opener, "accountOf", [d.processor, 1n])) as Address;
    const live = (await read("0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9", domains, "isLive", ["1.2.419.tape", container])) as boolean;
    expect(live, "1.2.419.tape is not live");
    return `1.2.419.tape is live, container ${container}`;
  },
  "live-pages": async () => {
    const bad: string[] = [];
    const notes: string[] = [];
    for (const p of ["", "play.html", "verify.html", "numbers.html", "tree.html", "agents.html", "api/health"]) {
      // a passing edge hiccup is tried again and reported; a page that keeps failing still fails (A5)
      try {
        const { res, retried } = await steadyFetch(`${LIVE}/${p}`);
        if (!res.ok) bad.push(`${p || "/"} ${res.status}`);
        const note = retryNote(p || "/", retried);
        if (note) notes.push(note);
        if (!res.ok || p.startsWith("api/")) continue;
        // a 200 from a page shell is not a page: its own script must load, and be the game's (A56)
        const html = await res.text();
        const src = /<script[^>]+type="module"[^>]+src="\.?\/?([^"]+)"/.exec(html)?.[1];
        if (!/<title>[^<]*(Lingxi|灵犀)/.test(html) || !src) {
          bad.push(`${p || "/"} is not a Lingxi page`);
          continue;
        }
        const js = await steadyFetch(`${LIVE}/${src}`);
        const body = js.res.ok ? await js.res.text() : "";
        if (!js.res.ok || !/javascript/.test(js.res.headers.get("content-type") ?? "") || body.length < 1_000) bad.push(`${p || "/"}'s script ${src} ${js.res.status}`);
      } catch (e) {
        bad.push(e instanceof Error ? e.message : String(e));
      }
    }
    expect(!bad.length, [...bad, ...notes].join(", "));
    return notes.length ? `all answer; ${notes.join("; ")}` : "all answer";
  },
};

// the sheet
interface Row {
  id: string;
  check: string;
}
const sheet = readFileSync(join(root, "docs/claims.md"), "utf8");
const rows: Row[] = sheet
  .split(/\r?\n/)
  .filter((l) => /^\| [a-z0-9-]+ \|/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()))
  .map((c) => ({ id: c[1]!, check: c[4]! }));
const facts = new Set([...readFileSync(join(root, "README.md"), "utf8").matchAll(/<!--f:([a-z0-9-]+)-->/g)].map((m) => m[1]!));

let failed = 0;
let pending = 0;
const say = (ok: boolean, id: string, text: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(18)} ${text}`);
};
/** a row whose evidence is not in yet: never PASS (A56) */
const pend = (id: string, text: string) => {
  pending++;
  console.log(`PENDING  ${id.padEnd(18)} ${text}`);
};

/** The read-only check of mainnet, run once for every judge row; each row passes only on the step it names (A56). */
let judged: Array<{ ok: boolean; what: string }> | null = null;
function judge(): Array<{ ok: boolean; what: string }> {
  if (judged) return judged;
  const once = () => {
    const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "scripts/judge-check.mts")], { cwd: root, encoding: "utf8", timeout: 20 * 60_000 });
    const steps = (r.stdout ?? "")
      .split(/\r?\n/)
      .map((l) => /^(PASS|FAIL)\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ ok: m[1] === "PASS", what: m[2]! }));
    return { steps, crashed: r.status !== 0 && !steps.some((s) => !s.ok), why: (r.stderr || r.error?.message || `exit ${r.status}`).split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? "" };
  };
  // a node that drops a read mid-run crashes the check before it can say anything: it is run once more, and if it
  // crashes again every judge row fails with the reason (a crash is never a pass)
  let run = once();
  if (run.crashed) {
    // a throttled node recovers within seconds: wait before the second run
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    run = once();
  }
  judged = run.crashed ? [...run.steps, { ok: false, what: `judge-check stopped: ${run.why} (every step)` }] : run.steps;
  return judged;
}

/** The machine, for the row runner (scripts/lib/claimsRun.mts, A87). */
const runDeps: RunDeps = {
  root: root.replace(/\\/g, "/"),
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, "utf8"),
  spawn: (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 20 * 60_000 });
    return { status: r.status, stdout: r.stdout ?? "" };
  },
  hasPackage: (dir) => existsSync(join(dir, "package.json")),
};
/** `--only a,b`: those rows alone (a check being worked on); the sheet-wide checks are then skipped */
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg >= 0 ? new Set((process.argv[onlyArg + 1] ?? "").split(",").filter(Boolean)) : null;
const seen = new Set<string>();
for (const r of rows.filter((x) => !only || only.has(x.id))) {
  if (seen.has(r.id)) say(false, r.id, "the id is used twice");
  seen.add(r.id);
  const [kind, ...rest] = r.check.split(":");
  const arg = rest.join(":").trim();
  if (kind === "auto") {
    const check = AUTO[arg];
    if (!check) {
      say(false, r.id, `no automatic check named ${arg}`);
      continue;
    }
    try {
      say(true, r.id, await check());
    } catch (e) {
      say(false, r.id, (e as Error).message);
    }
  } else if (kind === "test") {
    const t = runTest(arg, runDeps);
    if (t === "pending") pend(r.id, `browser spec ${arg}: not proven by a completed CI run on master yet`);
    else say(t.ok, r.id, `test ${arg}: ${t.why}`);
  } else if (kind === "facts") say(facts.has(arg), r.id, `README fact ${arg}${facts.has(arg) ? ", counted by readme-facts" : " is not marked in the README"}`);
  else if (kind === "judge") {
    const v = judgeVerdict(arg ? judge() : [], arg);
    say(v.ok, r.id, v.text);
  }
  else if (kind === "manual") say(arg.length > 20, r.id, arg.length > 20 ? "manual, evidence stated" : "manual with no evidence");
  else say(false, r.id, `no check: "${r.check}"`);
}
const unused = Object.keys(AUTO).filter((k) => !rows.some((r) => r.check === `auto:${k}`));
if (!only && unused.length) say(false, "sheet", `automatic checks no claim uses: ${unused.join(", ")}`);
console.log(`\n${only ? `${rows.filter((x) => only.has(x.id)).length} of ${rows.length}` : rows.length} claims, ${failed} failing${pending ? `, ${pending} pending` : ""}`);
process.exit(failed ? 1 : 0);
