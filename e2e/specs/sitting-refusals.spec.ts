/**
 * A50: when the server will not take a pet to a friend, the game says why. The cap itself (every pack an address still
 * has on the shelf counts) is proven by `services/api/test/sitting.test.ts`; reaching it from a browser takes eight
 * sends, so here the send is answered with each of the server's refusals as the server words them.
 */
import { expect, hatch, sheet, test } from "../fixtures";
import { reach } from "../helpers/chain";

for (const look of [
  { lang: "en", scheme: "light", size: "phone", send: "Send to a friend", said: { tooMany: "This address already has 8 pets' saves waiting with friends", full: "Lingxi's shelf for pets with friends is full for now", busy: "Too many sends from this address this hour" } },
  { lang: "zh", scheme: "dark", size: "desktop", send: "送去朋友家", said: { tooMany: "这个网络地址已经有 8 只宠物的存档放在朋友那里", full: "灵犀存放托人照看的宠物的空间暂时满了", busy: "这个网络地址这一小时送得太多了" } },
] as const) {
  test(`a send to a friend the server refuses says why (${look.lang}, ${look.scheme}, ${look.size})`, async ({ player }) => {
    test.setTimeout(180_000);
    const p = await player({ lang: look.lang, scheme: look.scheme, size: look.size });
    const { page } = p;
    await hatch(p, "Pip");
    let reason = "tooMany";
    await page.route(
      (u) => u.pathname === "/api/sit",
      (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false, reason }) }),
    );
    await sheet(page, "me");
    const send = await reach(page, `.sitpanel button.btn.primary`);
    for (const r of ["tooMany", "full", "busy"] as const) {
      reason = r;
      await send.click();
      const warn = page.locator(".sitpanel .sp-warn");
      await expect(warn, `"${r}" is said for what it is`).toContainText(look.said[r]);
      await expect(warn).not.toContainText(look.lang === "zh" ? "请再试一次" : "please try again");
      if (r === "tooMany") {
        await warn.scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`sit-tooMany-${look.lang}-${look.scheme}-${look.size}.png`) });
      }
    }
    await expect(page.getByRole("button", { name: look.send })).toBeEnabled();
  });
}
