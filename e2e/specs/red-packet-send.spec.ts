/**
 * A42: a red packet's link key is kept before its money is sent. A player fills a packet, and the page closes after
 * the wallet sent it but before the node told of its receipt (the receipt is held for the first visit only). On the
 * next visit the game finds the packet on X Layer by what it kept, lists it under the packets sent, and offers its
 * link again; the link carries the key the packet on chain was made with.
 */
import { type Address, type Hex, parseTransaction, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { XLAYER_USDT, readPacket } from "../../packages/chain/src/redpacket";
import type { Deployment } from "../../packages/chain/src/registry";
import { giveToken } from "../../packages/chain/scripts/lib/forkFund";
import { expect, hatch, sheet, test } from "../fixtures";
import { stored, walletOf } from "../helpers/browser";
import { forkOf, reach } from "../helpers/chain";

const NEXT_ID = [{ type: "function", name: "nextId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const;

for (const look of [
  { lang: "en", scheme: "light", size: "phone", fill: /^Fill the packet/, sentList: "Packets you sent", copy: "Copy link" },
  { lang: "zh", scheme: "dark", size: "desktop", fill: /^塞进红包/, sentList: "你发出的红包", copy: "复制链接" },
] as const) {
  test(`a packet whose page closed before its receipt is found on the next visit, with its link (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player, run }) => {
    test.setTimeout(6 * 60_000);
    const fork = await forkOf(run);
    const d = fork.d as unknown as Deployment;
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await giveToken(fork.pub, XLAYER_USDT, walletOf(run, p), parseUnits("10", 6));
    await hatch(p, "Kiri");
    const before = (await fork.pub.readContract({ address: d.redPacket as Address, abi: NEXT_ID, functionName: "nextId" })) as bigint;

    // this visit never hears of the packet's receipt, as when the tab closes while it is being confirmed; anything
    // else (the USDT approval a new sender sends first) is told of as usual
    let create: string | null = null;
    await page.route(
      (u) => u.href.startsWith(run.fork.rpc),
      async (route) => {
        const sent = JSON.parse(route.request().postData() ?? "null") as unknown;
        const calls = (Array.isArray(sent) ? sent : [sent]) as Array<{ id?: number; method?: string; params?: unknown[] } | null>;
        const toPacket = calls.find((c) => c?.method === "eth_sendRawTransaction" && parseTransaction(c.params?.[0] as Hex).to?.toLowerCase() === String(d.redPacket).toLowerCase());
        if (toPacket) {
          const r = await route.fetch();
          const body = (await r.json()) as { id?: number; result?: string } | Array<{ id?: number; result?: string }>;
          create = (Array.isArray(body) ? body.find((x) => x.id === toPacket.id) : body)?.result?.toLowerCase() ?? null;
          return route.fulfill({ response: r, body: JSON.stringify(body) });
        }
        const askedOfCreate = !!create && calls.some((c) => c?.method === "eth_getTransactionReceipt" && String(c.params?.[0]).toLowerCase() === create);
        if (!askedOfCreate) return route.continue();
        const held = calls.map((c) => ({ jsonrpc: "2.0", id: c?.id ?? null, result: null }));
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(Array.isArray(sent) ? held : held[0]) });
      },
    );
    await sheet(page, "me");
    // the panel sits low in the sheet and is drawn as it comes near the screen
    const amount = await reach(page, ".rp-send input[inputmode=decimal]");
    await amount.fill("3");
    await page.getByRole("button", { name: look.fill }).click();
    await expect.poll(async () => (await fork.pub.readContract({ address: d.redPacket as Address, abi: NEXT_ID, functionName: "nextId" })) as bigint, { message: "the packet reached X Layer", timeout: 120_000 }).toBe(before + 1n);
    await expect.poll(async () => JSON.parse((await stored(page, "lingxi.packets.pending.v1")) ?? "[]").length, { message: "its key was kept before it was sent" }).toBe(1);

    // the tab closes; the next visit hears of receipts as usual
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.reload();
    await page.locator(".stage").waitFor();
    await sheet(page, "me");
    await reach(page, ".rp-send");
    const list = page.locator(".rp-sent").filter({ hasText: look.sentList });
    await expect(list, "the packet is found on X Layer and listed").toContainText("3 USDT", { timeout: 60_000 });
    const copy = list.getByRole("button", { name: look.copy });
    await expect(copy, "and its link is offered again").toBeVisible({ timeout: 30_000 });
    await list.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`packet-found-${look.lang}-${look.scheme}-${look.size}.png`) });

    const sentNow = JSON.parse((await stored(page, "lingxi.packets.sent.v1"))!) as Array<{ id: string; link: string }>;
    expect(sentNow.map((s) => s.id)).toEqual([before.toString()]);
    const code = sentNow[0]!.link.slice(sentNow[0]!.link.indexOf("packet=lxp1.") + "packet=lxp1.".length);
    const { key } = JSON.parse(Buffer.from(code, "base64url").toString()) as { key: string };
    const onChain = await readPacket(fork.pub, d, before);
    expect(privateKeyToAccount(`0x${key}`).address, "the link carries the key the packet on chain was made with").toBe(onChain.key);
    expect(JSON.parse((await stored(page, "lingxi.packets.pending.v1")) ?? "[]"), "and the kept key is let go").toEqual([]);
  });
}
