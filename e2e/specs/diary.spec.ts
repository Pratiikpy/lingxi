/**
 * Public diaries, as players publish and read them (Z1, A39, A109). A pet kept on X Layer has its day saved, its owner
 * publishes its diary, and the pet's proof page reads it back and checks it against the chain. A diary longer than its
 * pet has lived on chain is refused by its age, and the game says so.
 */
import { type Hex, parseAbi } from "viem";
import { ZERO_HASH, chainAll } from "../../packages/game/src/log";
import { mindBrain } from "../../packages/game/src/family";
import { packState } from "../../packages/game/src/pack";
import { DIARY_FLOOR_WORDS } from "../../services/api/src/diaries";
import { expect, hatch, sheet, test } from "../fixtures";
import { expectedErrors, keepOnChain, stored, walletOf } from "../helpers/browser";
import { forkOf } from "../helpers/chain";

test("a kept pet's diary is published and its proof page reads it back, checked against the chain (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Pip");
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);
  await page.keyboard.press("Escape");
  // a moment to keep: the pet thinks once when fed, so the day has something in its diary
  await page.locator("button.act[data-hint=feed]").click();
  await page.locator(".sheet .bag-item button", { hasText: "Feed" }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await sheet(page, "me");
  await page.getByRole("button", { name: "Save today on chain" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "Publish its diary" }).click();
  await expect(page.locator(".publish-diary [role=status]"), "the diary is kept").toContainText(/Published: \d+ moments, checked against the chain/, { timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath("diary-published-en-light-phone.png") });

  // the first read of its diary fails at the server: the page says it could not be read, not that there is none (A109)
  const logRoute = new RegExp(`/api/pets/${petId}/log$`);
  await page.route(logRoute, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 502, body: "Bad Gateway" }) : r.continue()));
  await page.goto(`${p.web}/verify.html#${petId}`);
  const diary = page.locator(".v-diary");
  const unread = diary.locator("[data-diary=unread]");
  await expect(unread, "a failed read is said, with a retry").toContainText("could not be read this time", { timeout: 60_000 });
  await unread.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("diary-unread-en-light-phone.png") });
  // the page asked twice before saying so (A133); the browser logs each refused read, and those lines are this flow's
  await expectedErrors(p, /the server responded with a status of 502/, 2);
  await page.unroute(logRoute);
  await unread.getByRole("button", { name: "Try again" }).click();
  // the check waits for the indexer to read the pet's hatching (every 15 s), then passes, fails or says it cannot yet
  await expect(diary, "the diary check comes to a verdict").toContainText(/Its latest day|did not pass|isn't indexed yet/, { timeout: 180_000 });
  const why = (await page.getByTestId("log-result").textContent().catch(() => null)) ?? "(no log check shown)";
  await expect(diary, `the proof page reads the published diary and checks it (its log check said: ${why})`).toContainText("Its latest day, replayed moment by moment", { timeout: 5_000 });
  await expect(unread, "the retry's answer replaces the failed read").toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("diary-proof-en-light-phone.png"), fullPage: true });
});

test("a diary longer than its pet has lived on chain is refused, and the game says why (zh, dark, desktop)", async ({ player, run }) => {
  test.setTimeout(480_000);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  const { page } = p;
  await hatch(p, "Momo");
  await sheet(page, "me");
  await keepOnChain(p, run);
  // after keeping, a log of more moments than a pet kept minutes ago can have lived, with its own fingerprint, so the
  // chain agrees (put in after keeping: keeping starts the log at the kept state, A66)
  const words = Array.from({ length: DIARY_FLOOR_WORDS + 500 }, (_, i) => (i * 7919) & 0xffff);
  const hash = chainAll(ZERO_HASH, words);
  await page.addInitScript(
    ({ words, hash }) => {
      if (sessionStorage.getItem("a39.long")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<Record<string, unknown>> };
      save.pets[0] = { ...save.pets[0], pendingLog: words, logHash: hash, logMarks: [[0, (save.pets[0]!.beat as number) - words.length]] };
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      sessionStorage.setItem("a39.long", "1");
    },
    { words, hash },
  );
  await page.reload();
  await page.locator(".stage").waitFor();
  await sheet(page, "me");
  await page.getByRole("button", { name: "把今天存上链" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "发布日记" }).click();
  await expect(page.locator(".publish-diary [role=status]"), "refused by the pet's age, and said so").toHaveText("这本日记的时刻比Momo在 X Layer 上活过的还多，所以没有收下。", { timeout: 60_000 });
  await page.locator(".publish-diary [role=status]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("diary-too-long-zh-dark-desktop.png") });
});

/** Pushes a hatched pet's clock back `minutes`, so the next load catches up that many beats of its life in the browser. */
async function livedInBrowser(page: import("@playwright/test").Page, minutes: number): Promise<void> {
  await page.addInitScript((ms) => {
    if (sessionStorage.getItem("a66.lived")) return;
    const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: Array<{ bornAt: number; beat: number }> };
    save.pets[0]!.bornAt -= ms + 60_000;
    save.pets[0]!.beat -= Math.round(ms / 60_000);
    localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
    sessionStorage.setItem("a66.lived", "1");
  }, minutes * 60_000);
  await page.reload();
  await page.locator(".stage").waitFor();
}

test("a pet that lived in the browser before it was kept has a diary that checks (en, light, phone) (A66)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  await hatch(p, "Pip");
  await livedInBrowser(page, 20);
  const before = (JSON.parse((await stored(page, "lingxi.pets.v2"))!) as { pets: Array<{ pendingLog: number[] }> }).pets[0]!.pendingLog.length;
  expect(before, "it lived some moments before it was kept").toBeGreaterThanOrEqual(12);
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);
  // its log now starts where the hatch took its state
  const kept = (JSON.parse((await stored(page, "lingxi.pets.v2"))!) as { pets: Array<{ pendingLog: number[]; logStart?: number[] }> }).pets[0]!;
  expect(kept.logStart, "the memory where its log now starts is kept").toBeTruthy();
  expect(kept.pendingLog.length, "the moments before keeping are behind it").toBeLessThan(before);
  await page.keyboard.press("Escape");
  await page.locator("button.act[data-hint=feed]").click();
  await page.locator(".sheet .bag-item button", { hasText: "Feed" }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await sheet(page, "me");
  await page.getByRole("button", { name: "Save today on chain" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "Publish its diary" }).click();
  await expect(page.locator(".publish-diary [role=status]")).toContainText(/Published: \d+ moments, checked against the chain/, { timeout: 60_000 });

  await page.goto(`${p.web}/verify.html#${petId}`);
  const diary = page.locator(".v-diary");
  await expect(diary, "the diary check comes to a verdict").toContainText(/Its latest day|did not pass|isn't indexed yet|runs from its birth/, { timeout: 180_000 });
  const why = (await page.getByTestId("log-result").textContent().catch(() => null)) ?? "(no log check shown)";
  await expect(diary, `the diary of a pet played before it was kept checks (its log check said: ${why})`).toContainText("Its latest day, replayed moment by moment", { timeout: 5_000 });
  await diary.scrollIntoViewIfNeeded();
  await diary.screenshot({ path: test.info().outputPath("diary-played-first-en-light-phone.png") });
});

test("a pet kept before its log started at the kept state is said plainly (zh, dark, desktop) (A66)", async ({ player, run }) => {
  test.setTimeout(600_000);
  const fork = await forkOf(run);
  const p = await player({ lang: "zh", scheme: "dark", size: "desktop" });
  const { page } = p;
  await hatch(p, "Momo");
  const pet = (JSON.parse((await stored(page, "lingxi.pets.v2"))!) as { pets: Array<Record<string, unknown> & { line: "gentle"; instincts?: number; beat: number; brain: number[] }> }).pets[0]!;
  // a life in the browser whose replay, run a second time from the memory it reached, ends somewhere else: the
  // diary such a pet published under the old way of keeping could not check (A39's finding)
  const b = mindBrain({ line: pet.line, lessons: [], ...(pet.instincts ? { instincts: pet.instincts } : {}) });
  const run12 = (start: number[], ws: number[]) => {
    const st = Uint8Array.from(start);
    for (const w of ws) b.fast.step(st, w);
    return Array.from(st);
  };
  let words: number[] = [];
  let reached: number[] = [];
  for (let seed = 1; seed < 500; seed++) {
    words = Array.from({ length: 12 }, (_, i) => ((seed * 2654435761 + i * 40503) >>> 0) & 0xffff);
    reached = run12(new Array(b.nState).fill(0), words);
    if (run12(reached, words).join("") !== reached.join("")) break;
  }
  expect(run12(reached, words).join(""), "replayed again from where it reached, it ends elsewhere").not.toBe(reached.join(""));
  const old = { ...pet, pendingLog: words, logHash: chainAll(ZERO_HASH, words), brain: reached, logMarks: [[0, pet.beat - words.length]], segments: [{ from: 0, lessons: [] }] };
  // kept the old way: hatched with the state it had reached, its log still running from its birth
  const index = run.players.findIndex((x) => x.address.toLowerCase() === walletOf(run, p).toLowerCase());
  const wallet = fork.wallet(index);
  // the registry's own hatch, as the game sends it (registry.ts hatchOnChain), with the state this pet had reached
  const d = fork.d as unknown as { registry: Hex; processor: Hex; circuits: Record<string, { id: string }> };
  const tx = await wallet.writeContract({
    address: d.registry,
    abi: parseAbi(["function hatch(address to, uint8 line, address processor, uint64 brainId, uint256 initialState) returns (uint256)"]),
    functionName: "hatch",
    args: [wallet.account!.address, ["gentle", "bold", "curious"].indexOf(pet.line), d.processor, BigInt(d.circuits[pet.line]!.id), packState(old as never, "baby")],
    account: wallet.account!,
    chain: wallet.chain,
  });
  await fork.pub.waitForTransactionReceipt({ hash: tx });
  await page.addInitScript(
    ({ old, pending }) => {
      if (sessionStorage.getItem("a66.old")) return;
      const save = JSON.parse(localStorage.getItem("lingxi.pets.v2")!) as { pets: unknown[] };
      save.pets[0] = old;
      localStorage.setItem("lingxi.pets.v2", JSON.stringify(save));
      localStorage.setItem("lingxi.chain.pending.v1", JSON.stringify(pending));
      sessionStorage.setItem("a66.old", "1");
    },
    { old, pending: { [String(pet.bornAt)]: { tx, owner: wallet.account!.address, at: Date.now() } } },
  );
  await page.reload();
  await page.locator(".stage").waitFor();
  await sheet(page, "me");
  const petId = await keepOnChain(p, run);
  await page.getByRole("button", { name: "把今天存上链" }).click();
  await expect.poll(async () => JSON.parse((await stored(page, "lingxi.chain.v2"))!)[Object.keys(JSON.parse((await stored(page, "lingxi.chain.v2"))!))[0]!].lastDay, { timeout: 120_000 }).toBe(1);
  await page.getByRole("button", { name: "发布日记" }).click();
  await expect(page.locator(".publish-diary [role=status]")).toContainText(/已发布/, { timeout: 60_000 });

  await page.goto(`${p.web}/verify.html#${petId}`);
  const diary = page.locator(".v-diary");
  await expect(diary, "said plainly: it runs from its birth, before it was kept").toContainText("它发布的日记从它在浏览器里出生时记起，早于它上链", { timeout: 180_000 });
  await expect(page.getByTestId("log-result")).toHaveAttribute("data-result", "birth");
  await expect(page.getByTestId("log-result")).toContainText("从每只新宠物都有的初始记忆重放");
  await page.getByTestId("log-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("diary-old-pet-zh-dark-desktop.png") });
});
