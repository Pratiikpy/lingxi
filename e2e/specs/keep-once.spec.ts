/**
 * A20: a pet is never hatched on chain twice. A pet hatched with an instinct is kept while Lingxi's relayer turns its
 * circuit down (its answer intercepted, as a busy relayer would answer); the panel then shows the pet as kept, never
 * "Keep on X Layer" again, and says what is left; putting its mind on chain finishes the move with no second pet.
 */
import { parseAbi } from "viem";
import { dismiss, expect, sheet, test } from "../fixtures";
import { forkOf, walletOf } from "../helpers/browser";
import { reach } from "../helpers/chain";

const REGISTRY = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function pet(uint256 id) view returns ((address processor, uint64 brainId, uint8 line, uint8 brainBits, uint32 day, uint40 born, uint40 checkedAt, bytes32 logHash, uint256 state, uint128 parentA, uint128 parentB))",
]);

for (const look of [
  {
    lang: "en",
    scheme: "light",
    size: "phone",
    busy: "many requests",
    left: "its instincts are not yet",
    update: "Put its new mind on chain",
    keep: "Keep Pip on X Layer",
  },
  {
    lang: "zh",
    scheme: "dark",
    size: "desktop",
    busy: "请求太多",
    left: "它的本能还没有放上去",
    update: "把新心智放上链",
    keep: "把Pip放上 X Layer",
  },
] as const) {
  test(`a kept pet whose circuit is turned down is never kept twice (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
    run,
  }) => {
    test.setTimeout(420_000);
    const p = await player(look);
    const { page } = p;
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor({ timeout: 60_000 });
    await page.locator(".instinct").first().click();
    await page.fill("#pet-name", "Pip");
    await page.click(".hatch-go");
    await page.locator(".stage").waitFor();
    await page.waitForTimeout(1_200);
    await dismiss(page);

    const { pub, registry } = forkOf(run);
    const wallet = walletOf(run, p);
    const before = await pub.readContract({
      address: registry,
      abi: REGISTRY,
      functionName: "balanceOf",
      args: [wallet],
    });
    let refused = 0;
    await page.route(
      "**/api/tapeout",
      (route) => (
        refused++,
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, reason: "busy" }),
        })
      ),
    );

    await sheet(page, "me");
    await (await reach(page, "[data-hint=keep]")).click();
    const panel = page.locator(".mind-behind").first();
    // the hatch lands, then the relayer turns the circuit down: the panel says why
    await expect(page.getByText(look.busy).first(), "the panel says why the move did not finish").toBeVisible({
      timeout: 240_000,
    });
    expect(refused, "the relayer was asked once and refused").toBe(1);
    await expect(panel, "it shows the pet as kept and says what is left").toContainText(look.left);
    // ("Save today" carries the same hint for the quest ring, so the Keep button is found by its words)
    await expect(page.getByRole("button", { name: look.keep }), "it never offers to keep the pet again").toHaveCount(0);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`keep-once-${look.lang}-${look.scheme}-${look.size}.png`) });

    await page.unroute("**/api/tapeout");
    await page.locator(".mind-behind .btn.primary", { hasText: look.update }).click();
    await expect(page.locator(".mind-behind"), "the move finishes").toHaveCount(0, { timeout: 240_000 });
    const record = (await page.evaluate(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<
            string,
            { petId: string; brainKey: string }
          >,
        )[0],
    ))!;
    expect(record.brainKey, "its own circuit is recorded").not.toBe("[]");
    const after = await pub.readContract({
      address: registry,
      abi: REGISTRY,
      functionName: "balanceOf",
      args: [wallet],
    });
    expect(after - before, "one pet on chain, not two").toBe(1n);
    const onChain = await pub.readContract({
      address: registry,
      abi: REGISTRY,
      functionName: "pet",
      args: [BigInt(record.petId)],
    });
    expect(onChain.brainId, "the registry points at its own circuit, not the starter").not.toBe(1n);
  });
}
