// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Abi, type Address, type Hex, erc20Abi, parseAbi } from "viem";
import { FACTORY, breederV2Abi, petRegistryAbi, processorAbi, transistorsAbi } from "@lingxi/chain";
import { type Pet, createPet, familyOf, mindBrain } from "@lingxi/game";
import xlayer from "../../../../packages/chain/deployments/xlayer.json";
import { type Key, translate } from "../i18n";
import { type Net, type Storage, json, leave, reload, settle, visit } from "./testGame";
import { type FakeContract, Revert, fakeWallet, fakeXLayer } from "./testChain";
import { memoryStorage } from "./testStorage";

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const CHAIN = "lingxi.chain.v2";
const OLD_CHAIN = "lingxi.chain.v1";
const REGISTRY = xlayer.registry as Address;
const BREEDER = xlayer.breeder as Address;
const PROCESSOR = xlayer.processor as Address;
const TRANSISTORS = xlayer.transistors as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const FRIEND = "0x2222222222222222222222222222222222222222" as Address;
const PARTNER_OWNER = "0x3333333333333333333333333333333333333333" as Address;
const BEM = "0x4444444444444444444444444444444444444444" as Address;
const NOBODY = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const OKB = 10n ** 18n;
const lower = (a: string) => a.toLowerCase();

interface OnChainPet {
  owner: Address;
  line: number;
  processor: Address;
  brainId: bigint;
  brainBits: number;
  born: number;
  day: number;
  state: bigint;
}

/**
 * The contracts the game talks to, with the state a test sets: the pet registry, the BEM breeder, the BEM token, the
 * processor that tapes circuits out, its transistors and the factory. Each refuses as the deployed contract does.
 */
function contractsOnXLayer() {
  const pets = new Map<bigint, OnChainPet>();
  const sitters = new Map<bigint, { who: Address; until: bigint; by: Address }>();
  const consent = new Set<string>();
  const children = new Map<bigint, number>();
  const netlists = new Map<bigint, Hex>();
  const bemHeld = new Map<string, bigint>([[lower(OWNER), 100n * OKB]]);
  const allowances = new Map<string, bigint>();
  const rules = { breedFee: OKB, maxChildren: 4, breedRefusal: null as Revert | null, revertMined: null as string | null, refuseReceiver: false };
  let nextPet = 41n;
  let nextCircuit = 500n;

  const petOf = (id: bigint) => {
    const p = pets.get(id);
    if (!p) throw new Revert("UnknownPet");
    return p;
  };
  const keeper = (id: bigint, who: Address, now: number) => {
    const p = pets.get(id);
    const s = sitters.get(id);
    return !!p && (lower(p.owner) === lower(who) || (!!s && lower(s.who) === lower(who) && s.until > BigInt(now)));
  };
  const ownerOnly = (id: bigint, from: Address) => {
    if (lower(petOf(id).owner) !== lower(from)) throw new Revert("NotKeeper");
  };
  /** a call refused only once it is mined (the simulation passed, the block disagreed) */
  const minedRefusal = (name: string, dry: boolean) => {
    if (!dry && rules.revertMined === name) throw new Revert("NotKeeper");
  };

  const registry: FakeContract = {
    abi: petRegistryAbi as Abi,
    calls: {
      hatch: ([to, line, processor, brainId, state], c) => {
        minedRefusal("hatch", c.dry);
        // an address whose code takes no NFTs (an EIP-7702 delegation without a receiver): the safe mint refuses it
        if (rules.refuseReceiver) throw new Revert("ERC721InvalidReceiver", [to]);
        const id = nextPet;
        if (!c.dry) {
          pets.set(id, { owner: to as Address, line: line as number, processor: processor as Address, brainId: brainId as bigint, brainBits: 16, born: c.now, day: 0, state: state as bigint });
          nextPet++;
          c.emit("Hatched", { petId: id, to, line, processor, brainId, state });
        }
        return id;
      },
      pet: ([id]) => {
        const p = petOf(id as bigint);
        return { processor: p.processor, brainId: p.brainId, line: p.line, brainBits: p.brainBits, day: p.day, born: p.born, checkedAt: 0, logHash: ZERO32, state: p.state, parentA: 0n, parentB: 0n };
      },
      ownerOf: ([id]) => petOf(id as bigint).owner,
      checkpoint: ([id, day, state], c) => {
        const p = petOf(id as bigint);
        if (!keeper(id as bigint, c.from, c.now)) throw new Revert("NotKeeper");
        if ((day as number) <= p.day) throw new Revert("DayNotAfter", [day, p.day]);
        minedRefusal("checkpoint", c.dry);
        if (!c.dry) Object.assign(p, { day, state });
      },
      setSitter: ([id, who, until], c) => {
        ownerOnly(id as bigint, c.from);
        if (!c.dry) sitters.set(id as bigint, { who: who as Address, until: until as bigint, by: c.from });
      },
      sitters: ([id]) => {
        const s = sitters.get(id as bigint);
        return [s?.who ?? NOBODY, s?.until ?? 0n, s?.by ?? NOBODY];
      },
      isKeeper: ([id, who], c) => keeper(id as bigint, who as Address, c.now),
      setBrain: ([id, processor, brainId], c) => {
        ownerOnly(id as bigint, c.from);
        if (!c.dry) Object.assign(petOf(id as bigint), { processor, brainId });
      },
    },
  };
  const breeder: FakeContract = {
    abi: breederV2Abi as Abi,
    calls: {
      breedFee: () => rules.breedFee,
      bem: () => BEM,
      MAX_CHILDREN: () => rules.maxChildren,
      children: ([id]) => children.get(id as bigint) ?? 0,
      consent: ([id, who]) => consent.has(`${id}:${lower(who as string)}`),
      allowPartner: ([id, who, ok], c) => {
        if (lower(petOf(id as bigint).owner) !== lower(c.from)) throw new Revert("NotYours");
        const key = `${id}:${lower(who as string)}`;
        if (c.dry) return;
        if (ok) consent.add(key);
        else consent.delete(key);
      },
      breed: ([a, b, processor, brainId, line, maxFee], c) => {
        if (rules.breedRefusal) throw rules.breedRefusal;
        if (!consent.has(`${b}:${lower(c.from)}`)) throw new Revert("NoConsent");
        if ((bemHeld.get(lower(c.from)) ?? 0n) < (maxFee as bigint)) throw new Revert("PaymentShort");
        const id = nextPet;
        if (!c.dry) {
          pets.set(id, { owner: c.from, line: line as number, processor: processor as Address, brainId: brainId as bigint, brainBits: 12, born: c.now, day: 0, state: 0b101n });
          nextPet++;
          for (const p of [a, b] as bigint[]) children.set(p, (children.get(p) ?? 0) + 1);
          bemHeld.set(lower(c.from), (bemHeld.get(lower(c.from)) ?? 0n) - (maxFee as bigint));
          c.emit("Born", { child: id, parentA: a, parentB: b, processor, brainId });
        }
        return id;
      },
    },
  };
  const bem: FakeContract = {
    abi: erc20Abi as Abi,
    calls: {
      balanceOf: ([who]) => bemHeld.get(lower(who as string)) ?? 0n,
      allowance: ([who, spender]) => allowances.get(`${lower(who as string)}:${lower(spender as string)}`) ?? 0n,
      approve: ([spender, amount], c) => {
        if (!c.dry) allowances.set(`${lower(c.from)}:${lower(spender as string)}`, amount as bigint);
        return true;
      },
    },
  };
  const processor: FakeContract = {
    abi: processorAbi as Abi,
    calls: {
      transistors: () => TRANSISTORS,
      TAPEOUT_FEE: () => 10n ** 15n,
      tapeout: ([nl], c) => {
        const id = nextCircuit;
        if (!c.dry) {
          netlists.set(id, nl as Hex);
          nextCircuit++;
        }
        return id;
      },
      netlist: ([id]) => netlists.get(id as bigint) ?? "0x",
    },
  };
  const transistors: FakeContract = {
    abi: transistorsAbi as Abi,
    calls: { mintPrice: () => 10n ** 12n, protocolFee: () => 10n ** 12n, balanceOf: () => 0n, mint: () => undefined },
  };
  const factory: FakeContract = { abi: parseAbi(["function bem() view returns (address)"]) as Abi, calls: { bem: () => BEM } };
  return {
    pets,
    sitters,
    consent,
    children,
    bemHeld,
    rules,
    contracts: { [REGISTRY]: registry, [BREEDER]: breeder, [BEM]: bem, [PROCESSOR]: processor, [TRANSISTORS]: transistors, [FACTORY]: factory },
  };
}

type Relay = (path: string, body: { kind: string; petId: string; payload: string; auth: { signer: string } }) => unknown;

/** Opens the play page against a fake X Layer and a browser wallet, with the game's server answering relay requests. */
async function open(o: { storage?: Storage; wallet?: boolean; relay?: Relay; at?: number; hatch?: false | { instincts?: number } } = {}) {
  const x = contractsOnXLayer();
  const xl = fakeXLayer({ contracts: x.contracts, balances: { [OWNER]: OKB } });
  const relayed: Array<{ path: string; body: Parameters<Relay>[1] }> = [];
  let circuit = 77;
  const server: Net = async (url, init) => {
    const path = new URL(url).pathname;
    if (!path.startsWith("/api/tapeout")) throw new TypeError("Failed to fetch");
    const body = JSON.parse(String(init?.body)) as Parameters<Relay>[1];
    relayed.push({ path, body });
    return json(o.relay ? o.relay(path, body) : { ok: true, processor: PROCESSOR, brainId: String(circuit++), reused: false });
  };
  const v = await visit({ at: o.at ?? T0, ...(o.storage ? { storage: o.storage } : {}), net: xl.fetchVia(server) });
  const wallet = fakeWallet(xl, { account: OWNER });
  if (o.wallet !== false) Object.defineProperty(window, "ethereum", { value: wallet, configurable: true });
  const { useGame } = await import("./store");
  const { useWorld } = await import("./world");
  const { useBadges } = await import("./badges");
  const chain = await import("./chain");
  const { sessionAccount, AUTO_FUND, AUTO_LOW } = await import("./session");
  if (o.hatch !== false) useGame.getState().hatch("gentle", "Kiri", o.hatch?.instincts ?? 0);
  const pet = () => useGame.getState().pet!;
  const c = () => chain.useChain.getState();
  return { ...v, x, xl, wallet, relayed, useGame, useWorld, useBadges, chain, c, pet, session: () => sessionAccount().address, AUTO_FUND, AUTO_LOW };
}
type Page = Awaited<ReturnType<typeof open>>;

/** Keeps the pet on screen on X Layer, as the panel's button does, and returns its record. */
async function kept(p: Page) {
  await settle(p.c().keep(p.pet()));
  const record = p.c().record;
  if (!record) throw new Error(`the pet was not kept: ${p.c().error}`);
  return record;
}

/** What the chain panel shows for an error the store reports (ChainPanel maps these codes to these keys). */
const panelSays = (key: Key): [string, string] => [translate("en", key), translate("zh", key)];

const mined = (p: Page, functionName: string) => p.xl.mined.filter((m) => m.functionName === functionName);

afterEach(() => {
  Reflect.deleteProperty(window, "ethereum");
  leave();
});

describe("the chain store: keeping a pet on X Layer", () => {
  it("hatches the pet's twin with its starter brain, keeps the record, and reads it back after a reload", async () => {
    const p = await open();
    const record = await kept(p);
    expect(record).toEqual({ petId: "41", hatchTx: expect.stringMatching(/^0x[0-9a-f]{64}$/), lastDay: 0, owner: OWNER, bornChain: T0 / 1000, brains: { "[]": xlayer.circuits.gentle.id }, brainKey: "[]" });
    expect(p.c()).toMatchObject({ busy: "idle", error: null });
    expect(mined(p, "hatch")).toEqual([expect.objectContaining({ from: OWNER, status: "success", args: [OWNER, 0, PROCESSOR, 1n, expect.any(BigInt)] })]);
    expect(p.chain.recordOf(p.pet())).toEqual(record);
    expect(JSON.parse(p.storage.getItem(CHAIN)!)).toEqual({ [String(p.pet().bornAt)]: record });

    const again = await reload(p.storage, { at: T0 + MIN, net: p.xl.fetchVia(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    const { useChain } = await import("./chain");
    expect(again.claimed?.playing).toBe(true);
    expect(useChain.getState().record).toEqual(record);
  });

  it("a pet with instincts moves straight onto its own circuit, signed by the owner's wallet with no fee", async () => {
    const p = await open({ hatch: { instincts: 5 } });
    const record = await kept(p);
    expect(p.relayed).toEqual([{ path: "/api/tapeout", body: expect.objectContaining({ kind: "brain", petId: "41", auth: expect.objectContaining({ signer: OWNER }) }) }]);
    expect(JSON.parse(p.relayed[0]!.body.payload)).toEqual({ line: "gentle", lessons: [], instincts: 5, skills: [] });
    expect(mined(p, "setBrain")).toEqual([expect.objectContaining({ args: [41n, PROCESSOR, 77n] })]);
    const key = p.chain.mindKey([], 5);
    expect(record).toMatchObject({ brainKey: key, brains: { "[]": xlayer.circuits.gentle.id, [key]: "77" } });
    // the relayer tapes the circuit out: the player's wallet sends only the hatch and the move onto it
    expect(p.xl.mined.map((m) => m.functionName)).toEqual(["hatch", "setBrain"]);
    expect(p.x.pets.get(41n)?.brainId).toBe(77n);
  });

  it("the relayer turning the circuit down says why; the pet stays on chain on its starter brain", async () => {
    const p = await open({ hatch: { instincts: 5 }, relay: () => ({ ok: false, reason: "busy" }) });
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "busy" });
    expect(panelSays("relay.busy")).toEqual(["Lingxi's relayer has had many requests just now. Nothing was charged; try again in a little while.", "灵犀的中继刚才收到的请求太多。没有扣费，过一会儿再试吧。"]);
    // the hatch itself went through and is kept, so the next try only moves the brain
    expect(p.chain.recordOf(p.pet())).toMatchObject({ petId: "41", brainKey: "[]" });
    expect(mined(p, "setBrain")).toEqual([]);
  });

  // DEFECT: keep() stores the record once the hatch is mined, but sets `record` for the screen only at the very end; when
  // the relayer then turns the circuit down, the panel still shows "keep on X Layer", and keeping again hatches a second
  // twin on chain (a new pet id, more gas) and overwrites the first one's record on this device.
  it.fails("after the relayer turns the circuit down, the panel shows the pet as kept, so it is never hatched twice", async () => {
    const p = await open({ hatch: { instincts: 5 }, relay: () => ({ ok: false, reason: "busy" }) });
    await settle(p.c().keep(p.pet()));
    expect(p.c().record).toEqual(p.chain.recordOf(p.pet()));
  });

  it("with no wallet in the browser, the player is told to find one, and nothing is sent", async () => {
    const p = await open({ wallet: false });
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "noWallet", record: null });
    expect(panelSays("chain.noWallet")).toEqual(["No wallet found. Open this page in OKX Wallet, or install a browser wallet.", "没有找到钱包。请在 OKX 钱包里打开本页，或安装浏览器钱包。"]);
    expect(p.xl.mined).toEqual([]);
  });

  it("a wallet with no account open says the same", async () => {
    const p = await open();
    p.wallet.accounts = [];
    await settle(p.c().keep(p.pet()));
    expect(p.c().error).toBe("noAccount");
    expect(p.xl.mined).toEqual([]);
  });

  it("a wallet that does not know X Layer yet is asked to add it, then the pet is kept", async () => {
    const p = await open();
    p.wallet.knowsXLayer = false;
    await kept(p);
    expect(p.wallet.asked).toEqual(expect.arrayContaining(["wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_sendTransaction"]));
  });

  it("the player refusing the hatch in the wallet keeps nothing and says it did not go through", async () => {
    const p = await open();
    p.wallet.approves = false;
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "User rejected the request.", record: null });
    expect(panelSays("chain.failed")).toEqual(["That didn't go through. Nothing was charged; try again.", "没有成功，也没有扣费。再试一次吧。"]);
    expect(p.storage.getItem(CHAIN)).toBeNull();
  });

  // keep() reads its failure with firstLine() since A13; updateMind() still does not (A21)
  it("a wallet that refuses with a bare message frees the panel and says it did not go through", async () => {
    const p = await open();
    p.wallet.request = async () => Promise.reject("User denied account access");
    await settle(p.c().keep(p.pet()).catch(() => undefined));
    expect(p.c()).toMatchObject({ busy: "idle", error: expect.stringMatching(/\S/) });
  });

  it("a wallet whose address refuses pets is told so before anything is signed, and nothing is kept (A13)", async () => {
    const p = await open();
    p.x.rules.refuseReceiver = true;
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "cannotReceive", record: null });
    expect(p.xl.mined).toEqual([]);
    const [en, zh] = panelSays("chain.cannotReceive");
    expect(en).toMatch(/can't receive pets or items/);
    expect(zh).toMatch(/收不了宠物或道具/);
  });

  it("a hatch the block refuses after the simulation passed is not kept", async () => {
    const p = await open();
    p.x.rules.revertMined = "hatch";
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "hatch failed", record: null });
    expect(mined(p, "hatch")).toEqual([expect.objectContaining({ status: "reverted" })]);
    expect(p.storage.getItem(CHAIN)).toBeNull();
  });

  it("a node that does not answer: nothing is kept and the panel says it did not go through", async () => {
    const p = await open();
    p.xl.node.down = true;
    await settle(p.c().keep(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "HTTP request failed.", record: null });
    expect(p.xl.mined).toEqual([]);
  });

  it("with the game's own node down, X Layer's public nodes answer instead", async () => {
    const p = await open();
    p.xl.node.silent.add("http://localhost:8787/api/rpc");
    await kept(p);
    expect(p.c().error).toBeNull();
  });
});

describe("the chain store: saving the day", () => {
  it("writes today's checkpoint at the chain's own day, counts it for badges and quests, and the toast says so", async () => {
    const p = await open();
    await kept(p);
    const saved = vi.fn(() => p.useGame.getState().say("saved"));
    await settle(p.c().saveToday(p.pet(), saved));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { lastDay: 1, lastTx: expect.stringMatching(/^0x/), logLen: p.pet().pendingLog.length } });
    expect(mined(p, "checkpoint")).toEqual([expect.objectContaining({ from: OWNER, status: "success", args: [41n, 1, expect.any(BigInt), p.pet().logHash] })]);
    expect(p.x.pets.get(41n)?.day).toBe(1);
    expect(p.useBadges.getState().ledger.chainDays).toBe(1);
    expect(p.useWorld.getState().world.tally?.["SAVE:0"]).toBe(1);
    expect(translate("en", `note.${p.useGame.getState().toast!.note}` as Key)).toBe("Today is saved on X Layer.");
    expect(JSON.parse(p.storage.getItem(CHAIN)!)[String(p.pet().bornAt)]).toMatchObject({ lastDay: 1 });
  });

  it("a second save the same day is stopped before any transaction, and the player is told to come back tomorrow", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().saveToday(p.pet(), () => undefined));
    const saved = vi.fn();
    await settle(p.c().saveToday(p.pet(), saved));
    expect(p.c()).toMatchObject({ busy: "idle", error: "alreadySaved" });
    expect(panelSays("chain.alreadySaved")).toEqual(["Today is already saved. Come back tomorrow.", "今天已经存过了，明天再来吧。"]);
    expect(saved).not.toHaveBeenCalled();
    expect(mined(p, "checkpoint")).toHaveLength(1);
    // the next day on chain, it saves again
    vi.advanceTimersByTime(DAY);
    await settle(p.c().saveToday(p.pet(), saved));
    expect(p.c().record?.lastDay).toBe(2);
  });

  it("a node that does not answer: the day is not saved and the panel says it did not go through", async () => {
    const p = await open();
    await kept(p);
    p.xl.node.down = true;
    const saved = vi.fn();
    await settle(p.c().saveToday(p.pet(), saved));
    expect(p.c()).toMatchObject({ busy: "idle", error: "HTTP request failed.", record: { lastDay: 0 } });
    expect(panelSays("chain.failed")[0]).toBe("That didn't go through. Nothing was charged; try again.");
    expect(saved).not.toHaveBeenCalled();
  });

  it("a checkpoint the registry refuses (another device already saved this day) is not counted", async () => {
    const p = await open();
    await kept(p);
    p.x.pets.get(41n)!.day = 1;
    const saved = vi.fn();
    await settle(p.c().saveToday(p.pet(), saved));
    expect(p.c()).toMatchObject({ busy: "idle", error: 'The contract function "checkpoint" reverted.', record: { lastDay: 0 } });
    expect(saved).not.toHaveBeenCalled();
    expect(mined(p, "checkpoint")).toEqual([]);
    expect(p.useBadges.getState().ledger.chainDays).toBeUndefined();
  });

  it("the player refusing the save in the wallet saves nothing", async () => {
    const p = await open();
    await kept(p);
    p.wallet.approves = false;
    await settle(p.c().saveToday(p.pet(), () => undefined));
    expect(p.c()).toMatchObject({ busy: "idle", error: "User rejected the request.", record: { lastDay: 0 } });
  });

  it("a pet away with a friend, a pet not on chain, and a second tap while saving do nothing", async () => {
    const p = await open();
    await settle(p.c().saveToday(p.pet(), () => undefined));
    expect(p.wallet.asked).toEqual([]);
    await kept(p);
    await settle(p.c().saveToday({ ...p.pet(), away: { code: "c0de", key: "k", until: T0 + DAY, sitter: null } }, () => undefined));
    expect(mined(p, "checkpoint")).toEqual([]);
    const first = p.c().saveToday(p.pet(), () => undefined);
    const second = p.c().saveToday(p.pet(), () => undefined);
    await settle(Promise.all([first, second]));
    expect(mined(p, "checkpoint")).toHaveLength(1);
  });

  it("a quiet save with auto-save off never opens the wallet", async () => {
    const p = await open();
    await kept(p);
    const asked = p.wallet.asked.length;
    await settle(p.c().saveToday(p.pet(), () => undefined, true));
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { lastDay: 0 } });
    expect(p.wallet.asked).toHaveLength(asked);
  });
});

describe("the chain store: auto-save", () => {
  it("turning it on lets this device's key sit the pet for thirty days and tops its gas up, once", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    const until = T0 / 1000 + 30 * 86_400 - 600;
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { autoUntil: until } });
    expect(mined(p, "setSitter")).toEqual([expect.objectContaining({ args: [41n, p.session(), BigInt(until)] })]);
    expect(p.xl.mined.filter((m) => m.functionName === "" && lower(m.to) === lower(p.session()))).toEqual([expect.objectContaining({ value: p.AUTO_FUND })]);
    expect(p.chain.autoStatus(p.c().record, Date.now())).toBe("on");
    expect(p.chain.autoStatus(p.c().record, (until - 86_400) * 1000)).toBe("ending");
    expect(p.chain.autoStatus(p.c().record, (until + 1) * 1000)).toBe("off");
    expect(p.chain.autoStatus(null, Date.now())).toBe("off");
    expect(await settle(p.chain.autoGasLow())).toBe(false);
    // renewed with gas to spare: no second top-up
    await settle(p.c().enableAuto(p.pet()));
    expect(p.xl.mined.filter((m) => m.functionName === "" && lower(m.to) === lower(p.session()))).toHaveLength(1);
  });

  it("with auto-save on, the day is saved quietly by this device's key, with no wallet prompt", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    const asked = p.wallet.asked.length;
    const saved = vi.fn();
    await settle(p.c().saveToday(p.pet(), saved, true));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { lastDay: 1 } });
    expect(mined(p, "checkpoint")).toEqual([expect.objectContaining({ from: p.session(), status: "success" })]);
    expect(p.wallet.asked).toHaveLength(asked);
  });

  it("auto-save that a friend's sitting replaced on chain is turned off on this device", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    p.x.sitters.set(41n, { who: FRIEND, until: BigInt(T0 / 1000 + DAY / 1000), by: OWNER });
    await settle(p.c().saveToday(p.pet(), () => undefined, true));
    expect(p.c().record?.autoUntil).toBeUndefined();
    expect(p.c()).toMatchObject({ busy: "idle", error: null });
    expect(mined(p, "checkpoint")).toEqual([]);
  });

  it("a key low on gas does not save quietly, and the panel can say it is low", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    p.xl.balances.set(lower(p.session()), p.AUTO_LOW - 1n);
    expect(await settle(p.chain.autoGasLow())).toBe(true);
    await settle(p.c().saveToday(p.pet(), () => undefined, true));
    expect(mined(p, "checkpoint")).toEqual([]);
    expect(p.c()).toMatchObject({ busy: "idle", error: null });
  });

  it("a quiet save that fails stays quiet", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    p.xl.node.down = true;
    await settle(p.c().saveToday(p.pet(), () => undefined, true));
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { lastDay: 0 } });
  });

  it("turning it off clears the sitter on chain and here; a refusal on either says it did not go through", async () => {
    const p = await open();
    await kept(p);
    await settle(p.c().enableAuto(p.pet()));
    await settle(p.c().endSitting(p.pet()));
    expect(mined(p, "setSitter").at(-1)).toMatchObject({ args: [41n, NOBODY, 0n] });
    expect(p.c().record).not.toHaveProperty("autoUntil", expect.anything());
    p.wallet.approves = false;
    await settle(p.c().endSitting(p.pet()));
    expect(p.c().error).toBe("User rejected the request.");
    await settle(p.c().enableAuto(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "User rejected the request." });
  });
});

describe("the chain store: a friend sits the pet", () => {
  it("names the friend's wallet as sitter for the days chosen, ending auto-save", async () => {
    const p = await open();
    await kept(p);
    expect(await settle(p.c().sitWith(p.pet(), FRIEND, 3))).toBe(true);
    const until = T0 / 1000 + 3 * 86_400 - 600;
    expect(p.c().record).toMatchObject({ sitter: { who: FRIEND, until } });
    expect(mined(p, "setSitter")).toEqual([expect.objectContaining({ args: [41n, FRIEND, BigInt(until)] })]);
  });

  it("an address that is not one, days out of range, or the player's own wallet are refused with the reason", async () => {
    const p = await open();
    await kept(p);
    expect(await settle(p.c().sitWith(p.pet(), "0x1234", 3))).toBe(false);
    expect(p.c().error).toBe("badAddress");
    expect(panelSays("sit.badAddress")).toEqual(["That doesn't look like a wallet address (0x followed by 40 characters).", "这不像钱包地址（0x 加 40 个字符）。"]);
    expect(await settle(p.c().sitWith(p.pet(), FRIEND, 31))).toBe(false);
    expect(await settle(p.c().sitWith(p.pet(), FRIEND, 0))).toBe(false);
    expect(p.c().error).toBe("badDays");
    expect(panelSays("sit.badDays")).toEqual(["Choose between 1 and 30 days.", "请选 1 到 30 天。"]);
    expect(await settle(p.c().sitWith(p.pet(), OWNER, 3))).toBe(false);
    expect(p.c()).toMatchObject({ busy: "idle", error: "selfSitter" });
    expect(panelSays("sit.self")).toEqual(["That's your own wallet. Ask a friend instead.", "这是你自己的钱包，请填朋友的。"]);
    expect(mined(p, "setSitter")).toEqual([]);
  });

  it("with the node down it is not set, and with no record there is nothing to set", async () => {
    const p = await open();
    expect(await settle(p.c().sitWith(p.pet(), FRIEND, 3))).toBe(false);
    await kept(p);
    p.xl.node.down = true;
    expect(await settle(p.c().sitWith(p.pet(), FRIEND, 3))).toBe(false);
    expect(p.c()).toMatchObject({ busy: "idle", error: "HTTP request failed." });
    expect(p.c().record?.sitter).toBeUndefined();
  });
});

describe("the chain store: the pet's mind on chain", () => {
  const lesson = { when: { event: [2] }, then: { want: 2, mood: 3 } };

  it("a taught mind is taped out by the relayer and the pet moved onto it; a mind already taped out is reused", async () => {
    const p = await open();
    await kept(p);
    p.useGame.getState().learn(lesson);
    await settle(p.c().updateMind(p.pet()));
    const key = p.chain.mindKey([lesson]);
    expect(p.c()).toMatchObject({ busy: "idle", error: null, record: { brainKey: key, brains: { [key]: "77" } } });
    expect(JSON.parse(p.relayed[0]!.body.payload)).toEqual({ line: "gentle", lessons: [lesson], skills: [] });
    expect(p.x.pets.get(41n)?.brainId).toBe(77n);
    // the lesson forgotten and taught again: the circuit on record is used, nothing new taped out
    p.useGame.getState().arrange(0, "forget");
    await settle(p.c().updateMind(p.pet()));
    p.useGame.getState().learn(lesson);
    await settle(p.c().updateMind(p.pet()));
    expect(p.relayed).toHaveLength(1);
    expect(mined(p, "setBrain").map((m) => m.args[2])).toEqual([77n, 1n, 77n]);
  });

  it("an owned instinct is joined to the pet's own circuit by one more relayed circuit", async () => {
    const p = await open();
    await kept(p);
    const outside = { processor: PROCESSOR, id: "9", owner: OWNER, parts: [] };
    const pet = { ...p.pet(), outside };
    await settle(p.c().updateMind(pet));
    expect(p.relayed.map((r) => r.path)).toEqual(["/api/tapeout-instinct"]);
    expect(JSON.parse(p.relayed[0]!.body.payload)).toEqual({ own: "1", processor: PROCESSOR, id: "9" });
    expect(p.c().record?.brainKey).toBe(p.chain.mindKey([], 0, outside));
  });

  it("a child's mind is both halves in one relayed circuit", async () => {
    const p = await open();
    const family = familyOf({ name: "Kiri", line: "gentle", lessons: [] }, { name: "Bo", line: "bold", lessons: [] });
    const child: Pet = { ...createPet({ name: "Pip", line: "gentle", now: T0 + MIN, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [], family }) }), family, lessons: [lesson] };
    p.x.pets.set(50n, { owner: OWNER, line: 0, processor: PROCESSOR, brainId: 60n, brainBits: 12, born: T0 / 1000, day: 0, state: 0n });
    p.chain.setRecordOf(child, { petId: "50", hatchTx: ZERO32, lastDay: 0, owner: OWNER, bornChain: T0 / 1000, brains: { "[]": "60" }, brainKey: "[]" });
    await settle(p.c().updateMind(child));
    expect(p.relayed.map((r) => r.path)).toEqual(["/api/tapeout-child"]);
    expect(JSON.parse(p.relayed[0]!.body.payload)).toHaveProperty("card");
    expect(p.chain.recordOf(child)).toMatchObject({ brainKey: p.chain.mindKey([lesson]) });
  });

  it("the relayer refusing says why and leaves the pet on its old mind", async () => {
    const p = await open({ relay: () => ({ ok: false, reason: "notKeeper" }) });
    await kept(p);
    p.useGame.getState().learn(lesson);
    await settle(p.c().updateMind(p.pet()));
    expect(p.c()).toMatchObject({ busy: "idle", error: "notKeeper", record: { brainKey: "[]" } });
    expect(panelSays("relay.notKeeper")[0]).toMatch(/\S/);
    expect(mined(p, "setBrain")).toEqual([]);
  });

  it("taping out with the player's own wallet is quoted, run step by step, checked against the chain and moved onto", async () => {
    const p = await open();
    await kept(p);
    p.useGame.getState().learn(lesson);
    const q = await settle(p.c().quoteSelf(p.pet()));
    expect(q).toMatchObject({ feeIn: "okb", enough: true, mintPrice: 10n ** 12n, tapeoutFee: 10n ** 15n });
    expect(p.c()).toMatchObject({ busy: "idle", error: null });
    const steps: string[] = [];
    expect(await settle(p.c().selfTape(p.pet(), q!, (s) => steps.push(s)))).toBe(true);
    expect(steps).toEqual(["mintNand", "mintLatch", "tapeout", "verify", "setBrain"]);
    const key = p.chain.mindKey([lesson], 0);
    expect(p.c().record).toMatchObject({ brainKey: key, brains: { [key]: "500" } });
    expect(p.x.pets.get(41n)?.brainId).toBe(500n);
  });

  it("a quote or a tape-out that cannot be done says so; a child is never quoted", async () => {
    const p = await open();
    expect(await settle(p.c().quoteSelf({ ...p.pet(), family: familyOf({ name: "A", line: "gentle", lessons: [] }, { name: "B", line: "bold", lessons: [] }) }))).toBeNull();
    await kept(p);
    const q = await settle(p.c().quoteSelf(p.pet()));
    p.wallet.approves = false;
    expect(await settle(p.c().selfTape(p.pet(), q!, () => undefined))).toBe(false);
    expect(p.c()).toMatchObject({ busy: "idle", error: "User rejected the request." });
    p.xl.node.down = true;
    expect(await settle(p.c().quoteSelf(p.pet()))).toBeNull();
    expect(p.c()).toMatchObject({ busy: "idle", error: "HTTP request failed." });
  });
});

describe("the chain store: records on this device", () => {
  it("the log the last checkpoint committed is exported for the proof page", async () => {
    const p = await open();
    expect(p.c().exportLog(p.pet())).toBeNull();
    await kept(p);
    vi.advanceTimersByTime(5 * MIN);
    p.useGame.getState().tick();
    await settle(p.c().saveToday(p.pet(), () => undefined));
    const log = JSON.parse(p.c().exportLog(p.pet())!) as { petId: string; words: number[]; segments: Array<{ brainId: string | null; words: number[] }> };
    expect(log.petId).toBe("41");
    expect(log.words).toEqual(p.pet().pendingLog);
    expect(log.segments).toEqual([{ brainId: xlayer.circuits.gentle.id, words: p.pet().pendingLog }]);
  });

  it("forgetting the record takes it off this device", async () => {
    const p = await open();
    await kept(p);
    p.c().forget();
    expect(p.c().record).toBeNull();
    expect(JSON.parse(p.storage.getItem(CHAIN)!)).toEqual({});
  });

  it("the record on screen follows the pet on screen", async () => {
    const p = await open();
    const record = await kept(p);
    const first = p.pet();
    const second = { ...createPet({ name: "Bun", line: "bold", now: T0 + MIN, tzOffsetMin: 0, brain: mindBrain({ line: "bold", lessons: [] }) }), beat: Math.floor(T0 / MIN) };
    p.useGame.getState().welcome(second);
    expect(p.c().record).toBeNull();
    // a record set for a pet that is not on screen changes what the screen shows only once that pet is back
    p.chain.setRecordOf(first, { ...record, lastDay: 3 });
    expect(p.c().record).toBeNull();
    p.useGame.getState().switchTo(0);
    expect(p.c().record).toEqual({ ...record, lastDay: 3 });
  });

  it("a family request carries the pet's on-chain identity only when it lives on chain with a known brain", async () => {
    const p = await open();
    expect(p.c().infoOf(p.pet())).toBeNull();
    await kept(p);
    expect(p.c().infoOf(p.pet())).toEqual({ petId: "41", owner: OWNER, brain: xlayer.circuits.gentle.id });
    expect(p.c().recordOf(p.pet())?.petId).toBe("41");
  });

  it("the wallets that own pets here are listed once each, lowercase, with nothing that is not an address", async () => {
    const storage = memoryStorage();
    const rec = (owner: string) => ({ petId: "1", hatchTx: ZERO32, lastDay: 0, owner, bornChain: 0 });
    const mixedCase = "0x00000000000000000000000000000000000000Ab";
    storage.setItem(CHAIN, JSON.stringify({ a: rec(mixedCase), b: rec(lower(mixedCase)), c: rec("not-an-address"), d: rec(FRIEND) }));
    const p = await open({ storage, hatch: false });
    expect(p.chain.deviceWallets()).toEqual([lower(mixedCase), lower(FRIEND)]);
  });

  it("names a mind's circuit by its lessons, instincts, owned circuit and rule skills, and counts days as the registry does", async () => {
    const { chain } = await open({ hatch: false });
    expect(chain.mindKey([])).toBe("[]");
    expect(chain.mindKey([], 5)).toBe('{"lessons":[],"instincts":5}');
    expect(chain.mindKey([], 0, { processor: "0xcc", id: "9" })).toBe('{"lessons":[],"instincts":0,"outside":"0xcc:9"}');
    expect(chain.mindKey([], 0, undefined, [131])).toBe("[]|skills:131");
    const r = { petId: "1", hatchTx: ZERO32, lastDay: 0, owner: OWNER, bornChain: T0 / 1000 };
    expect([chain.chainDay(r, T0), chain.chainDay(r, T0 + DAY - 1), chain.chainDay(r, T0 + DAY)]).toEqual([1, 1, 2]);
    expect(chain.petKey({ bornAt: 12 })).toBe("12");
    expect(chain.explorerTx("0xabc")).toBe("https://www.oklink.com/xlayer/tx/0xabc");
    expect(chain.rpcs).toEqual(["http://localhost:8787/api/rpc", "https://xlayerrpc.okx.com", "https://rpc.xlayer.tech"]);
  });

  it("the one record kept before families belongs to the first pet", async () => {
    const storage = memoryStorage();
    const pet = { ...createPet({ name: "Old Bun", line: "gentle", now: T0 - DAY, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [] }) }), beat: Math.floor(T0 / MIN) };
    storage.setItem("lingxi.pets.v2", JSON.stringify({ active: 0, pets: [pet] }));
    const rec = { petId: "9", hatchTx: ZERO32, lastDay: 4, owner: OWNER, bornChain: 0 };
    storage.setItem(OLD_CHAIN, JSON.stringify(rec));
    const p = await open({ storage, hatch: false });
    expect(p.c().record).toEqual(rec);
  });

  it("records that will not parse are held for the player and the game starts with none", async () => {
    const storage = memoryStorage();
    storage.setItem(CHAIN, "{nope");
    const p = await open({ storage });
    expect(p.claimed?.damaged).toEqual([{ key: CHAIN, why: "unreadable" }]);
    expect(p.c().record).toBeNull();
    expect(p.chain.deviceWallets()).toEqual([]);
  });

  it("a season entry is signed as the pet: by this device's key when it keeps the pet, else by the owner's wallet", async () => {
    const p = await open();
    expect(await settle(p.chain.signSeasonEntry(p.pet(), { score: 1 }))).toBeNull();
    await kept(p);
    const byWallet = await settle(p.chain.signSeasonEntry(p.pet(), { score: 1 }));
    expect(byWallet).toMatchObject({ kind: "season", petId: "41", auth: { signer: OWNER } });
    await settle(p.c().enableAuto(p.pet()));
    const byKey = await settle(p.chain.signSeasonEntry(p.pet(), { score: 2 }));
    expect(byKey?.auth.signer).toBe(p.session());
  });
});

describe("the chain store: a family on chain", () => {
  /** A partner's pet on chain, owned by another player, with a known brain. */
  function partnerOnChain(p: Page, o: { consent?: boolean } = {}) {
    p.x.pets.set(90n, { owner: PARTNER_OWNER, line: 1, processor: PROCESSOR, brainId: 2n, brainBits: 16, born: T0 / 1000 - 30 * 86_400, day: 3, state: 0n });
    if (o.consent !== false) p.x.consent.add(`90:${lower(OWNER)}`);
    return { petId: "90", owner: PARTNER_OWNER, brain: "2" };
  }
  const childOf = (parent: Pet): Pet => {
    const family = familyOf({ name: parent.name, line: parent.line, lessons: [] }, { name: "Bo", line: "bold", lessons: [] });
    // born a minute after its parent: each pet on a device is known by its birth time
    return { ...createPet({ name: "Pip", line: "gentle", now: T0 + MIN, tzOffsetMin: 0, brain: mindBrain({ line: "gentle", lessons: [], family }) }), family };
  };

  it("the partner's owner allows the proposer on chain", async () => {
    const p = await open();
    expect(await settle(p.c().allow(p.pet(), PARTNER_OWNER))).toBe(false);
    await kept(p);
    expect(await settle(p.c().allow(p.pet(), PARTNER_OWNER))).toBe(true);
    expect(p.x.consent.has(`41:${lower(PARTNER_OWNER)}`)).toBe(true);
    p.wallet.approves = false;
    expect(await settle(p.c().allow(p.pet(), PARTNER_OWNER))).toBe(false);
    expect(p.c()).toMatchObject({ busy: "idle", error: "User rejected the request." });
  });

  it("a child is born on chain: its circuit taped out, the fee paid in BEM, and its record kept with the memory the chain mixed", async () => {
    const p = await open();
    await kept(p);
    const partner = partnerOnChain(p);
    const child = childOf(p.pet());
    const r = await settle(p.c().breed(p.pet(), partner, child));
    expect(r).toEqual({ ok: true, memory: [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(p.relayed.map((x) => x.path)).toEqual(["/api/tapeout-child"]);
    expect(JSON.parse(p.relayed[0]!.body.payload)).toEqual({ parents: [xlayer.circuits.gentle.id, "2"] });
    expect(mined(p, "approve")).toHaveLength(1);
    expect(mined(p, "breed")).toEqual([expect.objectContaining({ args: [41n, 90n, PROCESSOR, 77n, 0, OKB] })]);
    expect(p.chain.recordOf(child)).toMatchObject({ petId: "42", owner: OWNER, brainKey: "[]", brains: { "[]": "77" } });
    expect(p.x.bemHeld.get(lower(OWNER))).toBe(99n * OKB);
  });

  it("a pet not on chain cannot have a child there", async () => {
    const p = await open();
    expect(await settle(p.c().breed(p.pet(), { petId: "90", owner: PARTNER_OWNER, brain: "2" }, childOf(p.pet())))).toEqual({ ok: false, reason: "offChain" });
  });

  it("each refusal before anything is spent is named for the player", async () => {
    const p = await open();
    await kept(p);
    const child = childOf(p.pet());
    // a parent with four children already
    let partner = partnerOnChain(p);
    p.x.children.set(41n, 4);
    expect(await settle(p.c().breed(p.pet(), partner, child))).toEqual({ ok: false, reason: "tooManyChildren" });
    p.x.children.clear();
    // not enough BEM for the fee
    p.x.bemHeld.set(lower(OWNER), 0n);
    expect(await settle(p.c().breed(p.pet(), partner, child))).toEqual({ ok: false, reason: "notEnoughBem" });
    p.x.bemHeld.set(lower(OWNER), 100n * OKB);
    // the partner's details do not match X Layer
    expect(await settle(p.c().breed(p.pet(), { ...partner, owner: FRIEND }, child))).toEqual({ ok: false, reason: "partnerNotOnChain" });
    // the partner's owner has not consented
    p.x.consent.clear();
    partner = partnerOnChain(p, { consent: false });
    expect(await settle(p.c().breed(p.pet(), partner, child))).toEqual({ ok: false, reason: "noConsent" });
    expect(p.c()).toMatchObject({ busy: "idle", error: "NoConsent" });
    expect(p.relayed).toEqual([]);
    expect(mined(p, "breed")).toEqual([]);
  });

  it("the relayer turning the child's circuit down says why, and nothing is spent", async () => {
    const p = await open({ relay: () => ({ ok: false, reason: "budget" }) });
    await kept(p);
    const r = await settle(p.c().breed(p.pet(), partnerOnChain(p), childOf(p.pet())));
    expect(r).toEqual({ ok: false, reason: "budget" });
    expect(mined(p, "breed")).toEqual([]);
  });

  // DEFECT: the Breeder refuses with custom errors (NotAdult(uint256), TooSoon(uint256)); viem puts the error's name on
  // a later line of its message ('The contract function "breed" reverted.' first), and chain.ts matches only the first
  // line, so these two reasons never reach the Family screen, which shows the raw first line instead.
  it.fails("a birth the Breeder refuses because a parent is not grown on chain tells the player so", async () => {
    const p = await open();
    await kept(p);
    p.x.rules.breedRefusal = new Revert("NotAdult", [41n]);
    expect(await settle(p.c().breed(p.pet(), partnerOnChain(p), childOf(p.pet())))).toEqual({ ok: false, reason: "notAdultOnChain" });
  });

  it.fails("a birth the Breeder refuses because the parents are still resting tells the player so", async () => {
    const p = await open();
    await kept(p);
    p.x.rules.breedRefusal = new Revert("TooSoon", [41n]);
    expect(await settle(p.c().breed(p.pet(), partnerOnChain(p), childOf(p.pet())))).toEqual({ ok: false, reason: "tooSoon" });
  });

  it("a birth the Breeder refuses on chain sends nothing and keeps no record for the child", async () => {
    const p = await open();
    await kept(p);
    p.x.rules.breedRefusal = new Revert("NotAdult", [41n]);
    const child = childOf(p.pet());
    const r = await settle(p.c().breed(p.pet(), partnerOnChain(p), child));
    expect(r.ok).toBe(false);
    expect(p.chain.recordOf(child)).toBeNull();
    expect(p.c()).toMatchObject({ busy: "idle", error: expect.stringMatching(/\S/) });
    expect(mined(p, "breed")).toEqual([]);
    expect(mined(p, "approve")).toEqual([]);
  });
});
