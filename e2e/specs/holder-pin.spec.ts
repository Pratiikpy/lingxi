/**
 * H9, the holder perks, played on the fork. A real TapeCode-Test1 (one a real wallet holds alone, low in the
 * numbering) is moved on the fork into the first player's wallet. On the hatch screen that player checks the wallet
 * (balances only, nothing signed) and is told their eggs are gilded and a pin waits; they hatch, and in the Pet tab they
 * claim the pin in two taps, "check" then "claim with your TapeCode-Test1 #n", the token found without a number typed.
 * The pin is read back from the chain. A second player, whose wallet holds nothing, is told what the perks are, that
 * there is nothing to claim and that nothing was spent, and is offered no claim.
 */
import { type Address, parseAbi } from "viem";
import { type Opened, dismiss, expect, sheet, test } from "../fixtures";
import { type Fork, forkOf, reach } from "../helpers/chain";

const nft = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function transferFrom(address,address,uint256)",
]);
const giftAbi = parseAbi([
  "function test1() view returns (address)",
  "function claimed(address) view returns (bool)",
  "function outfit() view returns (uint256)",
  "function rig() view returns (address)",
]);

/** Opens the game on its hatch screen and checks the wallet there, as a player would before choosing an egg. */
async function checkOnHatch(p: Opened) {
  await p.page.goto(`${p.web}/play.html`);
  await p.page.locator(".hatch").waitFor({ timeout: 60_000 });
  await p.page.locator(".hatch-perk-btn").click();
}

async function hatchNow(p: Opened, name: string) {
  await p.page.fill("#pet-name", name);
  await p.page.click(".hatch-go");
  await p.page.locator(".stage").waitFor();
  await p.page.waitForTimeout(1_200);
  await dismiss(p.page);
}

test("the holder perks: named on the hatch screen, the pin claimed in two taps, and nothing taken from a non-holder", async ({
  player,
  run,
}) => {
  test.setTimeout(30 * 60_000);
  const fork: Fork = await forkOf(run);
  const gift = fork.d.holderGift as Address;
  const test1 = (await fork.pub.readContract({ address: gift, abi: giftAbi, functionName: "test1" })) as Address;
  const rig = (await fork.pub.readContract({ address: gift, abi: giftAbi, functionName: "rig" })) as Address;
  const pin = (await fork.pub.readContract({ address: gift, abi: giftAbi, functionName: "outfit" })) as bigint;
  const me = run.players[0]!.address as Address;
  const rpc = (m: string, params: unknown[]) => fork.pub.request({ method: m as never, params: params as never });

  await test.step("a real Test1 moves into the player's wallet on the fork", async () => {
    let token = 0n;
    let from: Address | null = null;
    for (let id = 1n; id <= 400n && !from; id++) {
      const o = (await fork.pub.readContract({
        address: test1,
        abi: nft,
        functionName: "ownerOf",
        args: [id],
      })) as Address;
      if (((await fork.pub.getCode({ address: o })) ?? "0x") !== "0x") continue;
      if ((await fork.pub.readContract({ address: test1, abi: nft, functionName: "balanceOf", args: [o] })) !== 1n)
        continue;
      token = id;
      from = o;
    }
    expect(from, "a plain wallet holding one low-numbered Test1").not.toBeNull();
    await rpc("anvil_impersonateAccount", [from]);
    await rpc("anvil_setBalance", [from, "0x56BC75E2D63100000"]);
    const hash = (await rpc("eth_sendTransaction", [
      {
        from,
        to: test1,
        data: (await import("viem")).encodeFunctionData({
          abi: nft,
          functionName: "transferFrom",
          args: [from!, me, token],
        }),
      },
    ])) as `0x${string}`;
    await fork.pub.waitForTransactionReceipt({ hash });
    expect(
      (
        (await fork.pub.readContract({ address: test1, abi: nft, functionName: "ownerOf", args: [token] })) as Address
      ).toLowerCase(),
    ).toBe(me.toLowerCase());
    expect(
      (await fork.pub.readContract({ address: rig, abi: nft, functionName: "balanceOf", args: [me] })) as bigint,
      "the player holds no Rig",
    ).toBe(0n);
  });

  const holder = await player({ lang: "en", scheme: "light", size: "phone", wallet: 0 });
  await test.step("the hatch screen names the perks and, after a check, the gilded shell (en, light, phone)", async () => {
    await checkOnHatch(holder);
    const perk = holder.page.locator(".hatch-perk");
    await expect(perk).toContainText("your eggs hatch from a gilded shell (you hold a TapeCode-Test1)", {
      timeout: 60_000,
    });
    await expect(perk).toContainText("a free holder pin, to claim in the Pet tab once your pet has hatched");
    await hatchNow(holder, "Mochi");
  });

  await test.step("the pin, claimed in two taps in the Pet tab", async () => {
    await sheet(holder.page, "me");
    const panel = await reach(holder.page, ".holders");
    // tap one: check the wallet
    await panel.locator(".row .btn").first().click();
    // the game finds the token itself (the index's hint, or every owner read through the door)
    const claim = holder.page.locator(".holder-gift .btn.primary", {
      hasText: /Claim it with your TapeCode-Test1 #\d+/,
    });
    await expect(claim, "the claim names the token found").toBeVisible({ timeout: 600_000 });
    // tap two: claim
    await claim.click();
    await expect(holder.page.locator(".holder-gift [role=status]")).toContainText("The holder pin is yours", {
      timeout: 180_000,
    });
    expect(
      await fork.pub.readContract({ address: gift, abi: giftAbi, functionName: "claimed", args: [me] }),
      "claimed on chain",
    ).toBe(true);
    expect(
      await fork.pub.readContract({
        address: fork.d.outfitMarketV2 as Address,
        abi: parseAbi(["function balanceOf(address,uint256) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [me, pin],
      }),
      "the pin is held",
    ).toBe(1n);
  });

  const stranger = await player({ lang: "zh", scheme: "dark", size: "desktop", wallet: 1 });
  await test.step("a wallet that holds nothing: told what the perks are, nothing to claim, nothing spent (zh, dark, desktop)", async () => {
    // the suite funds every player's wallet with BEM, which makes it a BEM holder: this one gives its BEM away first
    const w1 = run.players[1]!.address as Address;
    const held = await fork.bemOf(w1);
    if (held > 0n) {
      const w = fork.wallet(1);
      await fork.pub.waitForTransactionReceipt({
        hash: await w.writeContract({
          address: fork.bem,
          abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
          functionName: "transfer",
          args: [run.players[2]!.address as Address, held],
          account: w.account!,
          chain: w.chain,
        }),
      });
    }
    expect(await fork.bemOf(w1), "the stranger holds no BEM").toBe(0n);
    const before = await fork.pub.getBalance({ address: w1 });
    await checkOnHatch(stranger);
    await expect(stranger.page.locator(".hatch-perk")).toContainText("没有可领的东西；什么都没变，也没花钱", {
      timeout: 60_000,
    });
    await hatchNow(stranger, "Kiri");
    await sheet(stranger.page, "me");
    const panel = await reach(stranger.page, ".holders");
    await panel.locator(".row .btn").first().click();
    await expect(stranger.page.locator(".holder-gift")).toContainText("没有可领的东西，也没花钱", { timeout: 600_000 });
    await expect(stranger.page.locator(".holder-gift .btn.primary")).toHaveCount(0);
    expect(await fork.pub.getBalance({ address: w1 }), "nothing spent").toBe(before);
  });

  expect(holder.errors, "no console errors for the holder").toEqual([]);
  expect(stranger.errors, "no console errors for the stranger").toEqual([]);
});
