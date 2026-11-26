/**
 * Two players' pets made a family on X Layer (A31; out of birth-on-chain.spec.ts so the adoption spec, P9, plays the
 * same road): hatched, grown and bonded in their saves, each kept on chain by its own wallet, one proposing from the
 * room and the other's game showing the proposal checked on X Layer.
 */
import { type Page } from "@playwright/test";
import { parseAbi } from "viem";
import { dismiss, expect, sheet, test } from "../fixtures";
import { keepOnChain, stored, walletOf } from "./browser";
import { forkOf } from "./chain";
import { spotFor, tapVisitor } from "./room";

export const DAY = 86_400_000;
export const REGISTRY = parseAbi([
  "function pet(uint256 id) view returns ((address processor, uint64 brainId, uint8 line, uint8 brainBits, uint32 day, uint40 born, uint40 checkedAt, bytes32 logHash, uint256 state, uint128 parentA, uint128 parentB))",
  "function ownerOf(uint256 id) view returns (address)",
]);

/** Hatches a pet from the egg at `egg` and names it. */
export async function hatchEgg(page: Page, web: string, egg: number, name: string): Promise<void> {
  await page.goto(`${web}/play.html`);
  await page.locator(".hatch").waitFor({ timeout: 60_000 });
  await page.locator(".eggs .egg").nth(egg).click();
  await page.fill("#pet-name", name);
  await page.click(".hatch-go");
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
}

/**
 * Days of game time, in the save: the pet's hatch time moves back `days`, and it knows the friend (its player's id and
 * pet's name) at the bond a family needs. Written by a script that runs before the game's own on the next load, so the
 * page leaving cannot write the old save over it.
 */
export async function grownAndBonded(
  page: Page,
  days: number,
  friend: { id: string; name: string; line: string },
): Promise<void> {
  await page.addInitScript(
    ({ ms, friend }) => {
      // not on a blank page the test leaves through, where the browser denies storage
      if (location.protocol === "about:" || sessionStorage.getItem("a31.grown")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<{ bornAt: number }> };
      const bornAt = save.pets[0]!.bornAt - ms;
      save.pets[0]!.bornAt = bornAt;
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      const now = Date.now();
      const friends = {
        [String(bornAt)]: {
          [`${friend.id}:${friend.name}`]: {
            name: friend.name,
            line: friend.line,
            points: 60,
            day: 0,
            today: 0,
            first: now - ms,
            last: now,
          },
        },
      };
      localStorage.setItem("lingxi.friends.v1", JSON.stringify(friends));
      sessionStorage.setItem("a31.grown", "1");
    },
    { ms: days * DAY, friend },
  );
  await page.reload();
  await page.locator(".stage").waitFor();
  await page.waitForTimeout(1_200);
  await dismiss(page);
}

export type Fixtures = Parameters<Parameters<typeof test>[2]>[0];
export type Look = Parameters<Fixtures["player"]>[0];

/**
 * Two players, each with a grown pet kept on X Layer by its own wallet, the pets knowing each other well: B visits A,
 * A asks for a family from B's card, and B's game shows the proposal checked on X Layer. Returns before B says yes.
 */
export async function familyOnChain(
  player: Fixtures["player"],
  run: Fixtures["run"],
  looks: { a: Look; b: Look },
  words: { family: string; yes: string },
) {
  const a = await player(looks.a);
  const b = await player(looks.b);
  const fork = await forkOf(run);

  await hatchEgg(a.page, a.web, 0, "Mochi");
  await hatchEgg(b.page, b.web, 1, "Tofu");
  const idA = (await stored(a.page, "lingxi.player.v1"))!;
  const idB = (await stored(b.page, "lingxi.player.v1"))!;
  await grownAndBonded(a.page, 9, { id: idB, name: "Tofu", line: "bold" });
  await grownAndBonded(b.page, 9, { id: idA, name: "Mochi", line: "gentle" });

  // each keeps its pet on X Layer with its own wallet
  await sheet(a.page, "me");
  const petA = await keepOnChain(a, run);
  await a.page.keyboard.press("Escape");
  await sheet(b.page, "me");
  const petB = await keepOnChain(b, run);
  await b.page.keyboard.press("Escape");
  expect(
    (
      await fork.pub.readContract({
        address: fork.d.registry,
        abi: REGISTRY,
        functionName: "ownerOf",
        args: [BigInt(petA)],
      })
    ).toLowerCase(),
  ).toBe(walletOf(run, a).toLowerCase());

  // Tofu visits Mochi's home; Mochi's player asks for a family from the visitor's card
  await b.page.goto(`${b.web}/play.html?visit=${idA}`);
  await b.page.locator(".stage").waitFor();
  await dismiss(b.page);
  const card = a.page.locator(".visitor-card");
  for (let tries = 0; tries < 20 && !(await card.isVisible()); tries++) {
    await tapVisitor(a.page, spotFor(idB), { own: "adult", nth: tries });
    await a.page.waitForTimeout(400);
  }
  await expect(card, "Tofu is picked in Mochi's room").toBeVisible();
  await card.getByRole("button", { name: words.family }).click();

  // Tofu's player sees the proposal checked on X Layer before Yes can be pressed
  const ask = b.page.locator(".fam-modal");
  await ask.waitFor({ timeout: 30_000 });
  await expect(ask, "the proposal says what of Tofu goes into the little one").toContainText("Tofu");
  const yes = ask.getByRole("button", { name: words.yes });
  await expect(yes, "the proposal is checked on X Layer before Yes can be pressed").toBeEnabled({ timeout: 60_000 });
  return { a, b, fork, petA, petB, ask, yes };
}

/** The little one's id: the chain record on A's device that is neither parent's. */
export async function childOf(page: Page, parents: string[]): Promise<string> {
  const records = JSON.parse((await stored(page, "lingxi.chain.v2"))!) as Record<string, { petId: string }>;
  return Object.values(records)
    .map((r) => r.petId)
    .find((id) => !parents.includes(id))!;
}

/** The registry's record of a pet. */
export const petOnChain = (fork: Awaited<ReturnType<typeof forkOf>>, id: string) =>
  fork.pub.readContract({ address: fork.d.registry, abi: REGISTRY, functionName: "pet", args: [BigInt(id)] });
