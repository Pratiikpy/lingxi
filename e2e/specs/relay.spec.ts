/**
 * A signed relay: a pet kept on X Layer learns something its mind on chain does not hold, and the game asks the
 * server's relayer to tape out its new brain. The game signs that request with the owner's wallet; the relayer tapes
 * the circuit out and the pet takes it, read back from the registry on the fork. The same request sent again, the
 * request without its signature, and one claiming another signer are each refused by the API. Once auto-save makes
 * this device's own key the pet's sitter, the next request is signed by that key, with no wallet at all.
 */
import { dismiss, expect, hatch, sheet, test } from "../fixtures";
import { forkOf, keepOnChain, reach, teach } from "../helpers/chain";

interface SignedRequest {
  kind: string;
  petId: string;
  payload: string;
  auth: { signer: string; nonce: string; time: number; signature: string };
}

test("a pet's new mind is taped out by a signed relay request (en, light, phone)", async ({ player, run }) => {
  test.setTimeout(6 * 60_000);
  const fork = await forkOf(run);
  const p = await player({ lang: "en", scheme: "light", size: "phone" });
  const { page } = p;
  const sent: SignedRequest[] = [];
  const answered: Array<Promise<{ ok: boolean; brainId?: string }>> = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/tapeout") && r.postData())
      sent.push(JSON.parse(r.postData()!) as SignedRequest);
  });
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/api/tapeout"))
      answered.push(r.json() as Promise<{ ok: boolean; brainId?: string }>);
  });
  const api = (body: unknown) =>
    fetch(`${run.api}/api/tapeout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: p.web },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as { reason?: string } }));
  const reopen = async () => {
    await page.reload();
    await page.locator(".stage").waitFor();
    await page.waitForTimeout(1_200);
    await dismiss(page);
  };

  await hatch(p, "Pip");
  await sheet(page, "me");
  const { petId } = await keepOnChain(page);
  expect(await fork.ownerOf(petId), "the pet is kept on the fork by the player's wallet").toBe(run.players[0]!.address);
  const brain0 = await fork.brainOf(petId);

  // a lesson its mind on chain lacks; the game asks for the new brain through the relayer
  await teach(page, { when: { hunger: [3], joy: [0] }, then: { want: 5, mood: 2 } });
  await reopen();
  await sheet(page, "me");
  await (await reach(page, ".mind-behind .btn.primary")).click();
  await expect(page.locator(".mind-behind"), "the mind is no longer behind").toHaveCount(0, { timeout: 120_000 });
  const brain1 = await fork.brainOf(petId);
  expect(brain1, "the pet's brain on chain moved").not.toBe(brain0);
  expect((await Promise.all(answered)).at(-1), "to the circuit the relayer taped out").toEqual(
    expect.objectContaining({ ok: true, brainId: brain1.toString() }),
  );
  expect(sent.length, "the game sent its relay request").toBeGreaterThan(0);
  expect(
    sent.every((s) => s.auth && s.payload),
    "every request the game sent is the signed form",
  ).toBe(true);
  const walletSigner = sent[0]!.auth.signer.toLowerCase();
  expect(walletSigner, "the owner's wallet signed it").toBe(run.players[0]!.address.toLowerCase());

  // the API's refusals: a replay, no signature, another signer
  const replay = await api(sent[0]);
  expect([replay.status, replay.body.reason], "the same signed request again is refused").toEqual([401, "replayed"]);
  const bare = await api(JSON.parse(sent[0]!.payload));
  expect(bare.status, "the request without its signature is refused").toBe(400);
  const forged = await api({
    ...sent[0],
    auth: { ...sent[0]!.auth, signer: "0x000000000000000000000000000000000000bEEF" },
  });
  expect(forged.status, "a request claiming another signer is refused").toBe(401);

  // auto-save makes this device's key the pet's sitter: it signs the next request, with no wallet
  await sheet(page, "me");
  await (await reach(page, ".keeping .btn.primary")).click();
  await page.waitForFunction(
    () =>
      Object.values(
        JSON.parse(localStorage.getItem("lingxi.chain.v2") ?? "{}") as Record<string, { autoUntil?: number } | null>,
      ).some((r) => r && r.autoUntil),
    undefined,
    { timeout: 180_000 },
  );
  await teach(page, { when: { hunger: [0], joy: [3] }, then: { want: 2, mood: 3 } });
  sent.length = 0;
  answered.length = 0;
  await reopen();
  await sheet(page, "me");
  await (await reach(page, ".mind-behind .btn.primary")).click();
  await expect(page.locator(".mind-behind"), "the mind is no longer behind").toHaveCount(0, { timeout: 240_000 });
  const brain2 = await fork.brainOf(petId);
  expect(sent.length, "the game sent its second relay request").toBeGreaterThan(0);
  const deviceSigner = sent[0]!.auth.signer.toLowerCase();
  expect(deviceSigner, "with auto-save on, the device key signs, not the wallet").not.toBe(walletSigner);
  expect(await fork.isKeeper(petId, deviceSigner as `0x${string}`), "the device key is the pet's sitter on chain").toBe(
    true,
  );
  expect(brain2, "the pet takes the new brain").not.toBe(brain1);
  expect((await Promise.all(answered)).at(-1), "the one the relayer taped out").toEqual(
    expect.objectContaining({ ok: true, brainId: brain2.toString() }),
  );
  await page.screenshot({ path: test.info().outputPath("relay-done-en-light-phone.png") });
});
