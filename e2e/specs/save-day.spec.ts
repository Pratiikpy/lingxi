/**
 * A18: a day saved on chain from the game, as a player saves it, and what the chain then holds. No browser test pressed
 * "Save today on chain" before A18, which now reads the pet's recorded line before the save is signed; the saved state
 * must be the pet's own line, and the save must land.
 */
import { parseAbi } from "viem";
import { dismiss, expect, sheet, test } from "../fixtures";
import { forkOf, keepOnChain, reach } from "../helpers/chain";

const PET = parseAbi([
  "function pet(uint256 id) view returns ((address processor, uint64 brainId, uint8 line, uint8 brainBits, uint32 day, uint40 born, uint40 checkedAt, bytes32 logHash, uint256 state, uint128 parentA, uint128 parentB))",
]);

for (const look of [
  { lang: "en", scheme: "light", size: "phone", egg: 1, save: "Save today on chain" },
  { lang: "zh", scheme: "dark", size: "desktop", egg: 2, save: "把今天存上链" },
] as const) {
  test(`a day is saved on chain from the game (${look.lang}, ${look.scheme}, ${look.size})`, async ({
    player,
    run,
  }) => {
    test.setTimeout(420_000);
    const p = await player(look);
    const { page } = p;
    // a bold or a curious egg: a state written with line 0 by mistake would pass for a gentle pet
    await page.goto(`${p.web}/play.html`);
    await page.locator(".hatch").waitFor({ timeout: 60_000 });
    await page.locator(".eggs .egg").nth(look.egg).click();
    await page.fill("#pet-name", "Pip");
    await page.click(".hatch-go");
    await page.locator(".stage").waitFor();
    await page.waitForTimeout(1_200);
    await dismiss(page);
    await sheet(page, "me");
    const record = await keepOnChain(page);
    const fork = await forkOf(run);
    const before = await fork.pub.readContract({
      address: fork.d.registry,
      abi: PET,
      functionName: "pet",
      args: [BigInt(record.petId)],
    });
    expect(before.day, "kept, not saved yet").toBe(0);
    expect(before.line, "kept as the egg's line").toBe(look.egg);

    await (await reach(page, `.btn.primary:has-text("${look.save}")`)).click();
    await page.waitForFunction(
      () =>
        Object.values(
          JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { lastDay?: number } | null>,
        ).some((r) => (r?.lastDay ?? 0) >= 1),
      undefined,
      { timeout: 180_000 },
    );
    const after = await fork.pub.readContract({
      address: fork.d.registry,
      abi: PET,
      functionName: "pet",
      args: [BigInt(record.petId)],
    });
    expect(after.day, "the chain holds day 1").toBe(1);
    expect(Number((after.state >> 152n) & 3n), "its saved state is its own line").toBe(after.line);
    await page.screenshot({ path: test.info().outputPath(`save-day-${look.lang}-${look.scheme}-${look.size}.png`) });
  });
}
