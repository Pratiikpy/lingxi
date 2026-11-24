/**
 * Pet homes and letters on an X Layer mainnet fork (skipped unless FORK_RPC
 * points at a local node): two owners, each with a freshly generated key funded
 * only on the fork, tape out their pet's brain, open its home, open a mailbox,
 * and exchange a sealed letter through TapeSend's live hub. A third wallet can
 * neither open someone else's home nor read the letter.
 */

import { describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  numberToHex,
  pad,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { STARTERS, compileProgram, netlistBytes } from "@lingxi/brain";
import { quoteTapeout, tapeOutYourself } from "../src/selftape";
import {
  HomeError,
  homeCallFee,
  keepOutfitAtHome,
  takeOutfitFromHome,
  checkHub,
  lettersStatus,
  mailKey,
  HUB,
  HUB_IMPLEMENTATIONS_XLAYER,
  moveIntoHome,
  openHome,
  openMailbox,
  openingFee,
  readHome,
  readLetters,
  sendLetter,
} from "../src/home";
import { xLayer } from "../src/tapeout";
import { encodeDesign } from "@lingxi/art";
import { publishDesign } from "../src/outfits";
import { homePageHtml, homeSiteName, processorIndex, publishHomePage, readHomePage } from "../src/homepage";

const RPC = process.env.FORK_RPC;
const LINGXI: Address = "0xf70d324Da8C1C4Cb0dE3FF147E53E7E9db543c4e";
const factoryAbi = [
  {
    type: "function",
    name: "cpuAt",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;
const FACTORY: Address = "0x1f09DAeFA827f02CBb40967cc91b259763760761";

async function giveToken(pub: ReturnType<typeof createPublicClient>, token: Address, to: Address, amount: bigint) {
  for (let slot = 0n; slot < 60n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [to, slot]));
    const before = await pub.getStorageAt({ address: token, slot: key });
    await pub.request({
      method: "anvil_setStorageAt" as never,
      params: [token, key, pad(numberToHex(amount), { size: 32 })] as never,
    });
    if ((await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [to] })) === amount)
      return;
    await pub.request({
      method: "anvil_setStorageAt" as never,
      params: [token, key, (before ?? pad("0x0", { size: 32 })) as Hex] as never,
    });
  }
  throw new Error("balance slot not found");
}

async function homeFor(
  pub: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  stranger: ReturnType<typeof createWalletClient>,
  processor: Address,
  line: "gentle" | "bold",
) {
  const a = wallet.account!.address;
  await pub.request({ method: "anvil_setBalance" as never, params: [a, numberToHex(parseEther("5"))] as never });
  const net = compileProgram(STARTERS[line]);
  const bytes = netlistBytes(net);
  const short = await quoteTapeout(pub as never, processor, a, net.gates.length, net.latches.length, bytes.length);
  if (short.feeIn === "bem" && short.bemNeeded > 0n) await giveToken(pub, short.bem, a, short.bemNeeded);
  const q = await quoteTapeout(pub as never, processor, a, net.gates.length, net.latches.length, bytes.length);
  const { brainId } = await tapeOutYourself(pub as never, wallet, processor, bytes, q, () => undefined);
  const before = await readHome(pub as never, processor, brainId);
  expect(before.opened).toBe(false);
  expect(before.holder.toLowerCase()).toBe(a.toLowerCase());
  await expect(openHome(pub as never, stranger, processor, brainId)).rejects.toBeInstanceOf(HomeError);
  const fee = await openingFee(pub as never);
  const okbBefore = await pub.getBalance({ address: a });
  await openHome(pub as never, wallet, processor, brainId);
  expect(okbBefore - (await pub.getBalance({ address: a }))).toBeGreaterThanOrEqual(fee);
  const opened = await readHome(pub as never, processor, brainId);
  expect(opened.opened).toBe(true);
  expect(opened.mailbox).toBe(false);
  return opened;
}

/** The hub's implementation slot (ERC-1967). Since before block 76,250,000 it points at code TapeKit has not approved
 * (A12); the letter tests set it back to the approved implementation on the fork, to keep that path proven. */
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const approveHubOnFork = (pub: ReturnType<typeof createPublicClient>) =>
  pub.request({
    method: "anvil_setStorageAt" as never,
    params: [HUB, IMPL_SLOT, pad(HUB_IMPLEMENTATIONS_XLAYER[0]! as Hex, { size: 32 })] as never,
  });

describe.skipIf(!RPC)("pet homes and letters, on an X Layer fork", () => {
  it(
    "refuses today's hub, which runs code TapeKit has not approved, and keeps letters closed for it (A12)",
    { timeout: 60_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      const impl = `0x${(await pub.getStorageAt({ address: HUB, slot: IMPL_SLOT }))!.slice(-40)}`;
      if (HUB_IMPLEMENTATIONS_XLAYER.includes(impl)) return; // a fork from before the change, or after TapeKit approves it
      await expect(checkHub(pub as never)).rejects.toMatchObject({ code: "hubUnknown" });
      expect(await lettersStatus(pub as never, LINGXI)).toBe("hub");
    },
  );

  it(
    "homes open on Lingxi's processor; the approved hub refuses its mailboxes (it pins the older processor code)",
    { timeout: 400_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      await approveHubOnFork(pub);
      await checkHub(pub as never);
      const [owner, stranger] = [0, 1].map(() =>
        createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(generatePrivateKey()) }),
      );
      const home = await homeFor(pub, owner!, stranger!, LINGXI, "gentle");
      const key = await mailKey(owner!, home, 419);
      expect(await lettersStatus(pub as never, LINGXI)).toBe("processor");
      await expect(openMailbox(pub as never, owner!, home, key)).rejects.toThrow(/0x853f2907|NotCPU/);
      // a keepsake (another circuit the owner holds) goes into the home; the deed itself cannot
      const net = compileProgram(STARTERS.curious);
      const bytes = netlistBytes(net);
      const q = await quoteTapeout(
        pub as never,
        LINGXI,
        owner!.account!.address,
        net.gates.length,
        net.latches.length,
        bytes.length,
      );
      if (q.bemNeeded > 0n) await giveToken(pub, q.bem, owner!.account!.address, q.bemNeeded);
      const q2 = await quoteTapeout(
        pub as never,
        LINGXI,
        owner!.account!.address,
        net.gates.length,
        net.latches.length,
        bytes.length,
      );
      const { brainId: keepsake } = await tapeOutYourself(pub as never, owner!, LINGXI, bytes, q2, () => undefined);
      await expect(moveIntoHome(pub as never, owner!, LINGXI, home.circuit, home)).rejects.toBeInstanceOf(HomeError);
      await expect(moveIntoHome(pub as never, stranger!, LINGXI, keepsake, home)).rejects.toMatchObject({
        code: "notHolder",
      });
      await moveIntoHome(pub as never, owner!, LINGXI, keepsake, home);
      const ownerOf = [
        {
          type: "function",
          name: "ownerOf",
          stateMutability: "view",
          inputs: [{ name: "id", type: "uint256" }],
          outputs: [{ type: "address" }],
        },
      ] as const;
      expect(
        (
          (await pub.readContract({
            address: LINGXI,
            abi: ownerOf,
            functionName: "ownerOf",
            args: [keepsake],
          })) as Address
        ).toLowerCase(),
      ).toBe(home.container.toLowerCase());
    },
  );

  it(
    "on a processor the hub accepts, the same code opens mailboxes and exchanges a sealed letter",
    { timeout: 400_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      await approveHubOnFork(pub);
      const OLD = (await pub.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "cpuAt",
        args: [10n],
      })) as Address;
      expect(await lettersStatus(pub as never, OLD)).toBe("open");
      const wallets = [0, 1, 2].map(() =>
        createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(generatePrivateKey()) }),
      );
      const homes = [];
      for (const [i, line] of (["gentle", "bold"] as const).entries()) {
        const opened = await homeFor(pub, wallets[i]!, wallets[2]!, OLD, line);
        const key = await mailKey(wallets[i]!, opened, 10);
        expect(Buffer.from((await mailKey(wallets[i]!, opened, 10)).publicKey).toString("hex")).toBe(
          Buffer.from(key.publicKey).toString("hex"),
        );
        await openMailbox(pub as never, wallets[i]!, opened, key);
        const ready = await readHome(pub as never, OLD, opened.circuit);
        expect(ready.mailbox).toBe(true);
        homes.push({ home: ready, key });
      }

      const [mochi, rex] = homes;
      const sent = await sendLetter(
        pub as never,
        wallets[0]!,
        mochi!.home,
        rex!.home,
        { subject: "Hello from Mochi", body: "Mochi learned to share today. 今天学会分享了！" },
        mochi!.key,
      );
      expect(sent.inboxIndex).toBe(0n);
      const inbox = await readLetters(pub as never, rex!.home, rex!.key);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({
        subject: "Hello from Mochi",
        body: "Mochi learned to share today. 今天学会分享了！",
        verified: true,
      });
      expect(inbox[0]!.from.toLowerCase()).toBe(mochi!.home.container.toLowerCase());

      // the sender keeps a readable copy; a stranger's key opens nothing
      expect((await readLetters(pub as never, rex!.home, mochi!.key))[0]!.body).toContain("Mochi learned");
      const strangerKey = await mailKey(wallets[2]!, rex!.home, 10);
      const wrong = await readLetters(pub as never, rex!.home, strangerKey);
      expect(wrong[0]!.body).toBe("");
      expect(wrong[0]!.verified).toBe(false);
      // a letter to a home without a mailbox is refused before any transaction
      const empty = { ...rex!.home, mailbox: false };
      await expect(
        sendLetter(pub as never, wallets[0]!, mochi!.home, empty, { body: "hi" }, mochi!.key),
      ).rejects.toMatchObject({ code: "theirNoKey" });
    },
  );

  it(
    "an open home gets a page of its own on DeWEB, written only by the deed's holder",
    { timeout: 400_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      const [owner, stranger] = [0, 1].map(() =>
        createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(generatePrivateKey()) }),
      );
      const home = await homeFor(pub, owner!, stranger!, LINGXI, "bold");
      const index = await processorIndex(pub as never, LINGXI, 419);
      expect(index).toBe(419);
      const name = homeSiteName(home.circuit, index);
      const html = homePageHtml({
        petId: 1n,
        name: "Bruno",
        registry: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99",
        rpc: RPC!,
        proofUrl: "https://lingxi.knole.me/verify.html#1",
        siteName: name,
      });
      expect(await readHomePage(pub as never, home.container, name, html)).toEqual({
        published: false,
        live: false,
        current: false,
      });
      await pub.request({
        method: "anvil_setBalance" as never,
        params: [stranger!.account!.address, numberToHex(parseEther("1"))] as never,
      });
      await expect(publishHomePage(pub as never, stranger!, home.container, name, html)).rejects.toThrow();
      const txs = await publishHomePage(pub as never, owner!, home.container, name, html);
      expect(txs.length).toBeGreaterThanOrEqual(3);
      expect(await readHomePage(pub as never, home.container, name, html)).toEqual({
        published: true,
        live: true,
        current: true,
      });
      // publishing again replaces the page and leaves the name live
      const html2 = html.replace("Bruno", "Bruno II");
      await publishHomePage(pub as never, owner!, home.container, name, html2);
      expect(await readHomePage(pub as never, home.container, name, html2)).toEqual({
        published: true,
        live: true,
        current: true,
      });
    },
  );

  it(
    "outfits can be kept at home and taken back by the deed's holder, paying TapeOut's call fee",
    { timeout: 400_000 },
    async () => {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC!)) throw new Error("fork tests run only against a local node");
      const chain = { ...xLayer, rpcUrls: { default: { http: [RPC!] } } };
      const pub = createPublicClient({ chain, transport: http(RPC) });
      const [owner, stranger] = [0, 1].map(() =>
        createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(generatePrivateKey()) }),
      );
      const home = await homeFor(pub, owner!, stranger!, LINGXI, "gentle");
      const market: Address = "0xb9f6b18edd21933582ec69fb1e718d9629e684cd";
      const { id } = await publishDesign(
        pub as never,
        owner!,
        { v: 1, address: market },
        {
          pixels: encodeDesign({
            slot: "held",
            cells: [
              [1, 2],
              [2, 1],
            ],
            colours: ["#2b2140", "#ffc83d"],
          }),
          name: "Home hat",
          price: parseEther("0.001"),
          maxSupply: 5,
          royaltyBps: 0,
        },
      );
      const bal = (who: Address) =>
        pub.readContract({
          address: market,
          abi: [
            {
              type: "function",
              name: "balanceOf",
              stateMutability: "view",
              inputs: [
                { name: "a", type: "address" },
                { name: "i", type: "uint256" },
              ],
              outputs: [{ type: "uint256" }],
            },
          ] as const,
          functionName: "balanceOf",
          args: [who, id],
        });
      await expect(keepOutfitAtHome(pub as never, stranger!, market, id, home)).rejects.toMatchObject({
        code: "notHolder",
      });
      await keepOutfitAtHome(pub as never, owner!, market, id, home);
      expect(await bal(home.container)).toBe(1n);
      expect(await bal(owner!.account!.address)).toBe(0n);
      const fee = await homeCallFee(pub as never, home);
      expect(fee).toBeGreaterThan(0n);
      await pub.request({
        method: "anvil_setBalance" as never,
        params: [stranger!.account!.address, numberToHex(parseEther("1"))] as never,
      });
      await expect(takeOutfitFromHome(pub as never, stranger!, market, id, home)).rejects.toMatchObject({
        code: "notHolder",
      });
      const okb = await pub.getBalance({ address: owner!.account!.address });
      await takeOutfitFromHome(pub as never, owner!, market, id, home);
      expect(await bal(owner!.account!.address)).toBe(1n);
      expect(await bal(home.container)).toBe(0n);
      expect(okb - (await pub.getBalance({ address: owner!.account!.address }))).toBeGreaterThanOrEqual(fee);
    },
  );
});
