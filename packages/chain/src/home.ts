/**
 * Pet homes and letters (PRD Z4, Z5). A pet's home is the TapeOut container
 * (an ERC-6551 account) of a circuit its owner holds: the pet's own brain,
 * taped out by the owner. Opening the container is TapeOut's paid step. With a
 * home, a pet has a TapeSend mailbox on X Layer: a key derived from one wallet
 * signature is published on the DeWEB hub, and letters are sealed end to end
 * and written to the hub, where only the two homes can read them.
 */

import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  toHex,
} from "viem";
import {
  decodeContent,
  deriveKeyPair,
  encodeContent,
  hexToBytes,
  keyDerivationText,
  openPayload,
  seal,
} from "@lingxi/send";

export const OPENER: Address = "0x536adD8F30f03b69f6fbF29d425A816A0dC50106";
export const HUB: Address = "0xe61A9C7213a6Aa616C246a2B569e555B417b25ee";
/** the hub implementations accepted on X Layer (TapeKit's allow-list) */
export const HUB_IMPLEMENTATIONS_XLAYER: readonly string[] = ["0xdcc57797089ebd9f26e686379a4323f353a3f9c6"];
export const XLAYER_ID = 196;
/** bit 2 of the canonical chain list (BNB 0, Base 1, X Layer 2): a pet reads its letters on X Layer */
export const XLAYER_CHAINS = 1n << 2n;
const SUITE_X25519 = 1;
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const MAX_PAGE = 200n;

const openerAbi = parseAbi([
  "function open(address circuits, uint256 tokenId) payable",
  "function accountOf(address circuits, uint256 tokenId) view returns (address)",
  "function isDeployed(address circuits, uint256 tokenId) view returns (bool)",
  "function FEE() view returns (uint256)",
]);
const hubAbi = parseAbi([
  "struct KeyView { address container; bytes32 endpoint; bool opened; address current; uint8 suite; uint16 keyIndex; bytes32 key; bool usable; uint32 version; uint64 chains; }",
  "struct Entry { address from; uint56 blockNumber; uint40 timestamp; bytes32 digest; }",
  "function keyFor(address circuits, uint256 tokenId) view returns (KeyView)",
  "function publishKey(address circuits, uint256 tokenId, uint8 suite, uint16 keyIndex, bytes32 key, uint64 chains)",
  "function send(address circuits, uint256 tokenId, bytes32 to, bytes32 ref, bytes payload) returns (uint256)",
  "function inboxCount(bytes32 to) view returns (uint256)",
  "function inboxPage(bytes32 to, uint256 start, uint256 n) view returns (Entry[])",
  "event Sent(bytes32 indexed to, address indexed from, bytes32 indexed ref, uint256 inboxIndex, uint256 outboxIndex, bytes payload)",
]);
const ownerAbi = parseAbi(["function ownerOf(uint256 id) view returns (address)"]);

export class HomeError extends Error {
  override name = "HomeError";
  constructor(
    /** `unread`: X Layer could not be read just now, so the step was not tried; nothing else is meant by it */
    readonly code: "hubUnknown" | "notHolder" | "notOpened" | "noKey" | "theirNoKey" | "tooLong" | "damaged" | "unread",
    message: string,
  ) {
    super(message);
  }
}

/** uint32(0) ‖ uint64(chainId) ‖ container: a mailbox address any TapeSend client understands */
export function endpointId(container: Address, chainId = XLAYER_ID): Hex {
  const a = container.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a) || /^0x0{40}$/.test(a)) throw new HomeError("damaged", "bad container address");
  return `0x${"0".repeat(8)}${BigInt(chainId).toString(16).padStart(16, "0")}${a.slice(2)}` as Hex;
}

export interface Home {
  processor: Address;
  circuit: bigint;
  container: Address;
  endpoint: Hex;
  /** the container is opened (TapeOut's paid step) */
  opened: boolean;
  /** who holds the circuit, and so speaks for the home */
  holder: Address;
  /** a mailbox key is published and usable */
  mailbox: boolean;
  key: Hex;
  keyIndex: number;
}

/** The hub is only trusted while it runs an implementation on TapeKit's allow-list. */
export async function checkHub(pub: PublicClient): Promise<void> {
  const raw = await pub.getStorageAt({ address: HUB, slot: IMPL_SLOT });
  const impl = `0x${(raw ?? "0x").slice(-40)}`.toLowerCase();
  if (!HUB_IMPLEMENTATIONS_XLAYER.includes(impl))
    throw new HomeError("hubUnknown", `the DeWEB hub runs ${impl}, which is not on the accepted list`);
}

export async function readHome(pub: PublicClient, processor: Address, circuit: bigint): Promise<Home> {
  const v = (await pub.readContract({
    address: HUB,
    abi: hubAbi,
    functionName: "keyFor",
    args: [processor, circuit],
  })) as {
    container: Address;
    endpoint: Hex;
    opened: boolean;
    current: Address;
    usable: boolean;
    key: Hex;
    keyIndex: number;
  };
  return {
    processor,
    circuit,
    container: getAddress(v.container),
    endpoint: v.endpoint,
    opened: v.opened,
    holder: v.current,
    mailbox: v.usable,
    key: v.key,
    keyIndex: Number(v.keyIndex),
  };
}

export const openingFee = (pub: PublicClient): Promise<bigint> =>
  pub.readContract({ address: OPENER, abi: openerAbi, functionName: "FEE" }) as Promise<bigint>;

/** Opens the home: TapeOut's container opener, paid by the circuit's holder. */
export async function openHome(
  pub: PublicClient,
  wallet: WalletClient,
  processor: Address,
  circuit: bigint,
): Promise<Hex> {
  const me = wallet.account!.address;
  const holder = (await pub.readContract({
    address: processor,
    abi: ownerAbi,
    functionName: "ownerOf",
    args: [circuit],
  })) as Address;
  if (holder.toLowerCase() !== me.toLowerCase())
    throw new HomeError("notHolder", "only the circuit's holder can open its home");
  const fee = await openingFee(pub);
  const sim = await pub.simulateContract({
    address: OPENER,
    abi: openerAbi,
    functionName: "open",
    args: [processor, circuit],
    value: fee,
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  const r = await pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new HomeError("notOpened", "opening the home reverted");
  return tx;
}

export interface MailKey {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

/** The mailbox key: derived from one fixed wallet signature, so the same wallet always gets the same key back. */
export async function mailKey(
  wallet: WalletClient,
  home: Home,
  cpuIndex: number,
  keyIndex = home.keyIndex,
): Promise<MailKey> {
  const holder = wallet.account!.address;
  const p = {
    tokenId: home.circuit,
    cpuIndex,
    container: home.container,
    holder,
    hub: HUB,
    chainId: XLAYER_ID,
    keyIndex,
  };
  const signature = await wallet.signMessage({ account: wallet.account!, message: keyDerivationText(p) });
  return deriveKeyPair({ ...p, signature });
}

/** Publishes the mailbox key on the hub (the holder's own wallet; one transaction). */
export async function openMailbox(pub: PublicClient, wallet: WalletClient, home: Home, key: MailKey): Promise<Hex> {
  if (!home.opened) throw new HomeError("notOpened", "open the home first");
  const sim = await pub.simulateContract({
    address: HUB,
    abi: hubAbi,
    functionName: "publishKey",
    args: [home.processor, home.circuit, SUITE_X25519, home.keyIndex, toHex(key.publicKey), XLAYER_CHAINS],
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  await pub.waitForTransactionReceipt({ hash: tx });
  return tx;
}

export interface Letter {
  subject?: string;
  body: string;
}

/** Seals a letter for the other home (and a copy for our own) and writes it to the hub. */
export async function sendLetter(
  pub: PublicClient,
  wallet: WalletClient,
  from: Home,
  to: Home,
  letter: Letter,
  mine: MailKey,
): Promise<{ tx: Hex; inboxIndex: bigint }> {
  if (!from.opened) throw new HomeError("notOpened", "this home is not open");
  if (!to.opened || !to.mailbox) throw new HomeError("theirNoKey", "that home has no mailbox yet");
  if (!from.mailbox) throw new HomeError("noKey", "open your mailbox first");
  const content = encodeContent({
    ...(letter.subject ? { subject: letter.subject } : {}),
    body: letter.body,
    ts: Math.floor(Date.now() / 1000),
  });
  const ref = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
  const theirs = hexToBytes(to.key, 32);
  let payload: Uint8Array;
  try {
    payload = seal({
      content,
      recipients: [theirs, mine.publicKey],
      to: to.endpoint,
      from: from.endpoint,
      hub: HUB,
      ref,
      chainId: XLAYER_ID,
    });
  } catch (e) {
    throw new HomeError("tooLong", (e as Error).message);
  }
  const sim = await pub.simulateContract({
    address: HUB,
    abi: hubAbi,
    functionName: "send",
    args: [from.processor, from.circuit, to.endpoint, ref, toHex(payload)],
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  await pub.waitForTransactionReceipt({ hash: tx });
  return { tx, inboxIndex: sim.result as bigint };
}

export interface ReceivedLetter {
  index: number;
  from: Address;
  at: number;
  block: bigint;
  subject: string;
  body: string;
  /** the payload read from the chain matches the digest the hub stored */
  verified: boolean;
}

/** Reads and opens a home's letters, newest last; every payload is checked against the hub's digest. */
export async function readLetters(pub: PublicClient, home: Home, key: MailKey, start = 0n): Promise<ReceivedLetter[]> {
  const count = (await pub.readContract({
    address: HUB,
    abi: hubAbi,
    functionName: "inboxCount",
    args: [home.endpoint],
  })) as bigint;
  const out: ReceivedLetter[] = [];
  for (let s = start; s < count; s += MAX_PAGE) {
    const page = (await pub.readContract({
      address: HUB,
      abi: hubAbi,
      functionName: "inboxPage",
      args: [home.endpoint, s, MAX_PAGE],
    })) as Array<{ from: Address; blockNumber: bigint; timestamp: number; digest: Hex }>;
    for (let k = 0; k < page.length; k++) {
      const e = page[k]!;
      const index = Number(s) + k;
      const logs = await pub.getContractEvents({
        address: HUB,
        abi: hubAbi,
        eventName: "Sent",
        args: { to: home.endpoint, from: e.from },
        fromBlock: BigInt(e.blockNumber),
        toBlock: BigInt(e.blockNumber),
      });
      const log = logs.find((l) => Number((l.args as { inboxIndex: bigint }).inboxIndex) === index);
      if (!log) {
        out.push({
          index,
          from: e.from,
          at: Number(e.timestamp),
          block: BigInt(e.blockNumber),
          subject: "",
          body: "",
          verified: false,
        });
        continue;
      }
      const args = log.args as { ref: Hex; payload: Hex };
      const verified = keccak256(`0x${args.ref.slice(2)}${keccak256(args.payload).slice(2)}` as Hex) === e.digest;
      try {
        const opened = openPayload({
          payload: hexToBytes(args.payload),
          secretKey: key.secretKey,
          to: home.endpoint,
          from: endpointId(e.from),
          hub: HUB,
          ref: args.ref,
          chainId: XLAYER_ID,
        });
        const c = decodeContent(opened.content);
        out.push({
          index,
          from: e.from,
          at: Number(e.timestamp),
          block: BigInt(e.blockNumber),
          subject: c.kind === "message" ? c.subject : "",
          body: c.kind === "message" ? c.body : "",
          verified,
        });
      } catch {
        out.push({
          index,
          from: e.from,
          at: Number(e.timestamp),
          block: BigInt(e.blockNumber),
          subject: "",
          body: "",
          verified: false,
        });
      }
    }
  }
  return out;
}

export const containerOf = (pub: PublicClient, processor: Address, circuit: bigint): Promise<Address> =>
  pub.readContract({
    address: OPENER,
    abi: openerAbi,
    functionName: "accountOf",
    args: [processor, circuit],
  }) as Promise<Address>;

const transferAbi = parseAbi([
  "function transferFrom(address from, address to, uint256 id)",
  "function ownerOf(uint256 id) view returns (address)",
]);

/** Puts a circuit the owner holds (a season keepsake, say) into the pet's home. */
export async function moveIntoHome(
  pub: PublicClient,
  wallet: WalletClient,
  processor: Address,
  circuit: bigint,
  home: Home,
): Promise<Hex> {
  if (!home.opened) throw new HomeError("notOpened", "open the home first");
  if (circuit === home.circuit) throw new HomeError("damaged", "a home cannot hold its own deed");
  const me = wallet.account!.address;
  // a circuit that does not exist has no holder (ownerOf reverts), which is the same answer: not yours to move. X Layer
  // not answering is not that answer: it is said as what it is, and nothing is tried
  const holder = (await pub
    .readContract({ address: processor, abi: transferAbi, functionName: "ownerOf", args: [circuit] })
    .catch((e: unknown) => {
      if (e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError)) return null;
      throw new HomeError("unread", "X Layer could not be read just now");
    })) as Address | null;
  if (!holder || holder.toLowerCase() !== me.toLowerCase())
    throw new HomeError("notHolder", "you do not hold that circuit");
  const sim = await pub.simulateContract({
    address: processor,
    abi: transferAbi,
    functionName: "transferFrom",
    args: [me, home.container, circuit],
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  await pub.waitForTransactionReceipt({ hash: tx });
  const after = (await pub.readContract({
    address: processor,
    abi: transferAbi,
    functionName: "ownerOf",
    args: [circuit],
  })) as Address;
  if (after.toLowerCase() !== home.container.toLowerCase())
    throw new HomeError("damaged", "the circuit did not arrive");
  return tx;
}

/**
 * Whether letters between homes can open for circuits on this processor (A12): "open" when TapeSend's hub runs an
 * implementation on TapeKit's allow-list and pins this processor's code; "processor" when the approved hub pins another
 * processor's; "hub" when the hub runs code TapeKit has not approved (nothing of it is called) or its pin cannot be read.
 */
export async function lettersStatus(pub: PublicClient, processor: Address): Promise<"open" | "processor" | "hub"> {
  const raw = await pub.getStorageAt({ address: HUB, slot: IMPL_SLOT });
  const impl = `0x${(raw ?? "0x").slice(-40)}`.toLowerCase() as Address;
  if (!HUB_IMPLEMENTATIONS_XLAYER.includes(impl)) return "hub";
  let pinned: Hex;
  try {
    pinned = (await pub.readContract({
      address: impl,
      abi: parseAbi(["function circuitCodehash() view returns (bytes32)"]),
      functionName: "circuitCodehash",
    })) as Hex;
  } catch {
    return "hub";
  }
  const code = await pub.getCode({ address: processor });
  return code && keccak256(code) === pinned ? "open" : "processor";
}

const outfitAbi = parseAbi([
  "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
  "function balanceOf(address who, uint256 id) view returns (uint256)",
]);
const accountAbi = parseAbi([
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
]);
/** TapeOut's container reverts `ProtocolFeeTooLow(paid, required)` when `execute` is sent without its fee. */
const FEE_TOO_LOW = "0xafd49700";

/**
 * What one `execute` from the home costs: TapeOut takes a fee in the native coin on every call a container
 * makes. It is read by simulating a call with no fee and taking the amount the container asks for.
 */
export async function homeCallFee(pub: PublicClient, home: Home): Promise<bigint> {
  const data = encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [home.holder, 0n, "0x", 0] });
  try {
    await pub.call({ to: home.container, data, account: home.holder, value: 0n });
    return 0n;
  } catch (e) {
    // the revert data sits on the innermost error viem wraps (RawContractError.data)
    let raw = "";
    for (let err: unknown = e; err && !raw; err = (err as { cause?: unknown }).cause) {
      const d = (err as { data?: unknown }).data;
      const hex =
        typeof d === "string"
          ? d
          : typeof (d as { data?: unknown })?.data === "string"
            ? (d as { data: string }).data
            : "";
      if (hex.toLowerCase().startsWith(FEE_TOO_LOW)) raw = hex;
    }
    const m = new RegExp(`^${FEE_TOO_LOW}([0-9a-f]{64})([0-9a-f]{64})`, "i").exec(raw);
    if (!m) throw new HomeError("damaged", "the home did not say what a call costs");
    return BigInt(`0x${m[2]}`);
  }
}

/** Puts an outfit the owner holds (one copy) into the pet's home; it stays wearable from there. */
export async function keepOutfitAtHome(
  pub: PublicClient,
  wallet: WalletClient,
  market: Address,
  id: bigint,
  home: Home,
): Promise<Hex> {
  if (!home.opened) throw new HomeError("notOpened", "open the home first");
  const me = wallet.account!.address;
  const held = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [me, id],
  })) as bigint;
  if (held === 0n) throw new HomeError("notHolder", "you do not hold a copy of that outfit");
  const before = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [home.container, id],
  })) as bigint;
  const sim = await pub.simulateContract({
    address: market,
    abi: outfitAbi,
    functionName: "safeTransferFrom",
    args: [me, home.container, id, 1n, "0x"],
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  await pub.waitForTransactionReceipt({ hash: tx });
  const after = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [home.container, id],
  })) as bigint;
  if (after !== before + 1n) throw new HomeError("damaged", "the outfit did not arrive");
  return tx;
}

/** Takes one copy of an outfit back out of the home to the deed's holder, paying TapeOut's call fee. */
export async function takeOutfitFromHome(
  pub: PublicClient,
  wallet: WalletClient,
  market: Address,
  id: bigint,
  home: Home,
): Promise<Hex> {
  const me = wallet.account!.address;
  if (home.holder.toLowerCase() !== me.toLowerCase())
    throw new HomeError("notHolder", "only the deed's holder speaks for the home");
  const inside = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [home.container, id],
  })) as bigint;
  if (inside === 0n) throw new HomeError("notHolder", "that outfit is not in the home");
  const before = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [me, id],
  })) as bigint;
  const fee = await homeCallFee(pub, home);
  const move = encodeFunctionData({
    abi: outfitAbi,
    functionName: "safeTransferFrom",
    args: [home.container, me, id, 1n, "0x"],
  });
  const sim = await pub.simulateContract({
    address: home.container,
    abi: accountAbi,
    functionName: "execute",
    args: [market, 0n, move, 0],
    value: fee,
    account: wallet.account!,
  });
  const tx = await wallet.writeContract(sim.request);
  await pub.waitForTransactionReceipt({ hash: tx });
  const after = (await pub.readContract({
    address: market,
    abi: outfitAbi,
    functionName: "balanceOf",
    args: [me, id],
  })) as bigint;
  if (after !== before + 1n) throw new HomeError("damaged", "the outfit did not come back");
  return tx;
}
