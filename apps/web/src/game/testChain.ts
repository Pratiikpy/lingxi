/**
 * X Layer for the chain store's tests, at the page's own network boundary: a node that answers JSON-RPC the way a real
 * one does (calls answered by the test's contracts, a refusal as the contract's own error, mined receipts carrying
 * their events), and a wallet the player approves or refuses. Real viem and the real contract helpers of @lingxi/chain
 * talk to it through `fetch` and `window.ethereum`, so nothing here stands in for the code under test.
 */

import { type Abi, type Address, type Hex, decodeFunctionData, encodeAbiParameters, encodeErrorResult, encodeEventTopics, encodeFunctionResult, keccak256, numberToHex, parseTransaction, recoverTransactionAddress, stringToHex } from "viem";
import type { AbiEvent } from "viem";
import { type Net, json } from "./testGame";

/** A contract refusing a call with one of its own errors. */
export class Revert extends Error {
  constructor(
    readonly errorName: string,
    readonly args: readonly unknown[] = [],
  ) {
    super(`revert ${errorName}`);
  }
}

export interface CallContext {
  from: Address;
  value: bigint;
  /** an eth_call (a simulation or a read): it answers and changes nothing */
  dry: boolean;
  /** the block's time, in seconds */
  now: number;
  /** an event this call logs when it is mined */
  emit: (eventName: string, args: Record<string, unknown>) => void;
}
export type Handler = (args: readonly unknown[], ctx: CallContext) => unknown;
export interface FakeContract {
  abi: Abi;
  calls: Record<string, Handler>;
}

/** A JSON-RPC error as a node sends it. */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: Hex,
  ) {
    super(message);
  }
}

interface Mined {
  hash: Hex;
  from: Address;
  to: Address;
  functionName: string;
  args: readonly unknown[];
  value: bigint;
  status: "success" | "reverted";
}

const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const BLOOM = `0x${"0".repeat(512)}` as Hex;
const lower = (a: string) => a.toLowerCase();

export function fakeXLayer(o: { contracts: Record<string, FakeContract>; balances?: Record<string, bigint> }) {
  const contracts = new Map(Object.entries(o.contracts).map(([a, c]) => [lower(a), c]));
  const balances = new Map(Object.entries(o.balances ?? {}).map(([a, b]) => [lower(a), b]));
  const receipts = new Map<string, Record<string, unknown>>();
  const mined: Mined[] = [];
  const asked: string[] = [];
  let blockNumber = 76_300_000n;
  let sent = 0;
  const node = {
    /** no node answers at all */
    down: false,
    /** node URLs that do not answer (the others still do) */
    silent: new Set<string>(),
  };

  const seconds = () => Math.floor(Date.now() / 1000);

  function run(c: { from?: Address; to?: Address; data?: Hex; value?: Hex | bigint }, dry: boolean) {
    const to = c.to ?? "0x";
    const contract = contracts.get(lower(to));
    const value = typeof c.value === "bigint" ? c.value : BigInt(c.value ?? "0x0");
    if (!contract) {
      if (c.data && c.data !== "0x") throw new RpcError(-32000, `no contract at ${to}`);
      return { functionName: "", args: [] as readonly unknown[], result: "0x" as Hex, logs: [], value };
    }
    const { functionName, args = [] } = decodeFunctionData({ abi: contract.abi, data: c.data ?? "0x" });
    const handler = contract.calls[functionName];
    if (!handler) throw new Error(`the fake contract at ${to} has no ${functionName}`);
    const logs: Array<{ address: Address; topics: Hex[]; data: Hex }> = [];
    const emit = (eventName: string, eventArgs: Record<string, unknown>) => {
      const item = contract.abi.find((x): x is AbiEvent => x.type === "event" && x.name === eventName)!;
      const topics = encodeEventTopics({ abi: [item], eventName, args: eventArgs } as never) as Hex[];
      const plain = item.inputs.filter((i) => !i.indexed);
      logs.push({ address: to as Address, topics, data: encodeAbiParameters(plain, plain.map((i) => eventArgs[i.name!])) });
    };
    try {
      const out = handler(args, { from: c.from ?? ("0x" as Address), value, dry, now: seconds(), emit });
      return { functionName, args, result: encodeFunctionResult({ abi: contract.abi, functionName, result: out } as never) as Hex, logs, value };
    } catch (e) {
      if (e instanceof Revert) throw new RpcError(3, "execution reverted", encodeErrorResult({ abi: contract.abi, errorName: e.errorName, args: e.args } as never));
      throw e;
    }
  }

  function mine(c: { from: Address; to: Address; data?: Hex; value?: Hex | bigint }): Hex {
    const hash = keccak256(stringToHex(`tx ${++sent}`));
    blockNumber += 1n;
    let status: Mined["status"] = "success";
    let r: ReturnType<typeof run> | null = null;
    const contract = contracts.get(lower(c.to));
    const called = contract && c.data && c.data !== "0x" ? decodeFunctionData({ abi: contract.abi, data: c.data }) : null;
    try {
      r = run(c, false);
      if (r.value > 0n) {
        balances.set(lower(c.from), (balances.get(lower(c.from)) ?? 0n) - r.value);
        balances.set(lower(c.to), (balances.get(lower(c.to)) ?? 0n) + r.value);
      }
    } catch (e) {
      if (!(e instanceof RpcError) || e.code !== 3) throw e;
      status = "reverted";
    }
    const block = numberToHex(blockNumber);
    receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: "0x0",
      blockHash: keccak256(block),
      blockNumber: block,
      from: c.from,
      to: c.to,
      cumulativeGasUsed: "0x30d40",
      gasUsed: "0x30d40",
      effectiveGasPrice: "0x3b9aca00",
      contractAddress: null,
      logs: (r?.logs ?? []).map((l, i) => ({ ...l, blockNumber: block, blockHash: keccak256(block), transactionHash: hash, transactionIndex: "0x0", logIndex: numberToHex(i), removed: false })),
      logsBloom: BLOOM,
      status: status === "success" ? "0x1" : "0x0",
      type: "0x2",
    });
    mined.push({ hash, from: c.from, to: c.to, functionName: called?.functionName ?? "", args: called?.args ?? [], value: r?.value ?? 0n, status });
    return hash;
  }

  const block = () => ({
    number: numberToHex(blockNumber),
    hash: keccak256(numberToHex(blockNumber)),
    parentHash: ZERO32,
    timestamp: numberToHex(seconds()),
    baseFeePerGas: "0x1",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: "0x0000000000000000000000000000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    logsBloom: BLOOM,
    nonce: "0x0000000000000000",
    mixHash: ZERO32,
    sha3Uncles: ZERO32,
    stateRoot: ZERO32,
    receiptsRoot: ZERO32,
    transactionsRoot: ZERO32,
    size: "0x0",
    transactions: [],
    uncles: [],
  });

  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    asked.push(method);
    switch (method) {
      case "eth_chainId":
        return "0xc4";
      case "eth_blockNumber":
        return numberToHex(blockNumber);
      case "eth_getBlockByNumber":
        return block();
      case "eth_getBalance":
        return numberToHex(balances.get(lower(params[0] as string)) ?? 0n);
      case "eth_call":
        return run(params[0] as never, true).result;
      case "eth_estimateGas":
        run(params[0] as never, true);
        return "0x30d40";
      case "eth_getTransactionCount":
        return numberToHex(sent);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return "0x3b9aca00";
      case "eth_sendTransaction":
        return mine(params[0] as never);
      case "eth_sendRawTransaction": {
        const raw = params[0] as Hex;
        const tx = parseTransaction(raw);
        return mine({ from: await recoverTransactionAddress({ serializedTransaction: raw as never }), to: tx.to!, data: tx.data ?? "0x", value: tx.value ?? 0n });
      }
      case "eth_getTransactionReceipt":
        return receipts.get(params[0] as string) ?? null;
      default:
        throw new RpcError(-32601, `the method ${method} does not exist`);
    }
  }

  /** a node URL as the page names it (viem adds a trailing slash to a bare host) */
  const nodeUrl = (url: string) => url.replace(/\/$/, "");
  const isNode = (url: string) => /\/api\/rpc$/.test(nodeUrl(url)) || nodeUrl(url) === "https://xlayerrpc.okx.com" || nodeUrl(url) === "https://rpc.xlayer.tech";

  /** The page's fetch: node URLs reach the node, anything else goes to `rest` (the game's server, the clock). */
  const fetchVia =
    (rest: Net): Net =>
    async (url, init) => {
      if (!isNode(url)) return rest(url, init);
      if (node.down || node.silent.has(nodeUrl(url))) throw new TypeError("Failed to fetch");
      const { id, method, params } = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
      try {
        return json({ jsonrpc: "2.0", id, result: await rpc(method, params ?? []) });
      } catch (e) {
        if (!(e instanceof RpcError)) throw e;
        return json({ jsonrpc: "2.0", id, error: { code: e.code, message: e.message, ...(e.data ? { data: e.data } : {}) } });
      }
    };

  return { node, mined, asked, balances, fetchVia, rpc, mine, seconds };
}
export type FakeXLayer = ReturnType<typeof fakeXLayer>;

const rejected = () => Object.assign(new Error("User rejected the request."), { code: 4001 });

/**
 * The player's browser wallet (EIP-1193), as the page finds it on `window.ethereum`. The player approves or refuses
 * what it asks; anything that is not the wallet's own question goes to the node, as a real wallet's does.
 */
export function fakeWallet(chain: FakeXLayer, o: { account: Address }) {
  const wallet = {
    /** the player approves what the wallet asks (transactions, signatures) */
    approves: true,
    /** the wallet does not know X Layer yet, so it must be added */
    knowsXLayer: true,
    accounts: [o.account] as Address[],
    asked: [] as string[],
    async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
      wallet.asked.push(method);
      switch (method) {
        case "eth_requestAccounts":
          return wallet.accounts;
        case "wallet_switchEthereumChain":
          if (!wallet.knowsXLayer) throw Object.assign(new Error("Unrecognized chain ID 0xc4."), { code: 4902 });
          return null;
        case "wallet_addEthereumChain":
          wallet.knowsXLayer = true;
          return null;
        case "eth_sendTransaction":
          if (!wallet.approves) throw rejected();
          return chain.mine(params[0] as never);
        case "personal_sign":
          if (!wallet.approves) throw rejected();
          return `0x${"11".repeat(65)}`;
        default:
          try {
            return await chain.rpc(method, params);
          } catch (e) {
            throw Object.assign(new Error((e as Error).message), { code: (e as { code?: number }).code, data: (e as { data?: Hex }).data });
          }
      }
    },
  };
  return wallet;
}
export type FakeWallet = ReturnType<typeof fakeWallet>;
