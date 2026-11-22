/**
 * The wording fixes the audits asked for (A43 to A47, A55, A58), each held by a check that fails on the old, false
 * sentence and wants the true one, so a fix undone is caught like any other (A87).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\u00a0/g, " ");

describe("the wording the audits corrected stays corrected (A87)", () => {
  it("A43: a pet's mind is taped out on X Layer once it is kept there, not before", () => {
    expect(read("README.md")).not.toMatch(/Every pet's mind is a TapeOut circuit/);
    for (const page of ["apps/web/src/verify/VerifyApp.tsx", "apps/web/src/agents/AgentsApp.tsx"]) {
      expect(read(page), page).not.toMatch(/mind is a TapeOut circuit on X Layer/);
      expect(read(page), page).toMatch(/keeps it (on X Layer|there)/);
    }
    expect(read("README.md")).toMatch(/once its owner keeps it on X Layer, that circuit is taped/);
  });

  it("A44: letters between homes are said to be closed, as they are", () => {
    expect(read("README.md")).not.toMatch(/TapeSend letters between homes and the Telegram Mini App/);
    expect(read("README.md")).toMatch(/letters between homes stay closed/);
  });

  it("A45: Builders' Lane is five tribute pets, of which only Behemoth runs a community circuit", () => {
    expect(read("README.md")).not.toMatch(/circuits from the TapeOut community/);
    expect(read("README.md")).toMatch(/five tribute pets/);
  });

  it("A46: Lingxi takes no share of BEM payments; it does not claim no contract holds a balance", () => {
    expect(read("README.md")).not.toMatch(/Lingxi keeps no BEM/);
    expect(read("README.md")).not.toMatch(/no contract ever holds a balance to steal/);
    expect(read("README.md")).toMatch(/takes no share of any BEM payment/);
  });

  it("A47: ownership is two-step where it is, and the README does not say everywhere", () => {
    expect(read("README.md")).not.toMatch(/Ownership is two-step everywhere/);
    expect(read("README.md")).toMatch(/handed over in two steps/);
  });

  it("A55: the on-page note says the log hash chains every input since hatching", () => {
    const note = read("apps/web/src/OnChainNote.tsx");
    expect(note).not.toMatch(/every thought since the last save/);
    expect(note).toMatch(/chained over every input/);
  });

  it("A90: letters between homes are said to be closed for the real reason, and never promised to open by themselves", () => {
    const home = read("apps/web/src/play/Home.tsx");
    expect(home).not.toMatch(/They open here as soon as it does/);
    expect(home).not.toMatch(/一旦接受，这里就会开放/);
    expect(home).not.toMatch(/Letters between homes are coming next/);
    // H13 shipped pets' letters over TapeRelay, so no state says they are still planned (H13c)
    expect(home).not.toMatch(/planned over TapeRelay|计划改走 TapeRelay/);
    expect(home.match(/Pets' letters travel over TapeRelay instead/g)?.length, "every state says where pets' letters go now").toBe(3);
    expect(home.match(/宠物的信改走 TapeRelay/g)?.length).toBe(3);
    expect(read("README.md")).not.toMatch(/until the hub accepts circuits from Lingxi's processor/);
    expect(read("README.md")).toMatch(/the hub runs code TapeKit has not approved/);
    expect(read("README.md")).not.toMatch(/planned over TapeRelay/);
  });

  it("A91: the proof page says it asks Sourcify through Lingxi's server, which keeps answers, not live each time", () => {
    const table = read("apps/web/src/verify/ContractTable.tsx");
    expect(read("README.md")).not.toMatch(/asks Sourcify live each time it opens/);
    expect(read("README.md")).toMatch(/through Lingxi's server, which keeps each answer for up to ten minutes/);
    expect(table).toMatch(/through Lingxi's server, which keeps each answer for up to ten minutes/);
    expect(table).toMatch(/服务器会把每个答复保留最多十分钟/);
    expect(table).not.toMatch(/This column asks Sourcify each time the page opens\$\{VIA_SERVER/);
  });

  it("A92: what holds only for pets kept on X Layer is said of those pets, not of every pet", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/every move can be checked against the brain on X Layer/);
    expect(readme).not.toMatch(/Every pet ever hatched or bred appears on the tree of life/);
    expect(readme).not.toMatch(/\| every pet brain, the evolution circuit/);
    expect(readme).toMatch(/Every pet hatched or bred on X Layer appears on the tree of life/);
    const strings = read("apps/web/src/i18n/strings.ts");
    expect(strings).not.toMatch(/so anyone can check every thought it had/);
    expect(strings).toMatch(/every thought between them once you publish its diary/);
  });

  it("A95: smaller wordings say what holds", () => {
    const agents = read("apps/web/src/agents/AgentsApp.tsx");
    expect(agents).not.toMatch(/the rest are kept for players|其余留给玩家/);
    expect(agents).toMatch(/may take at most 16 of the week's 64 places; players may fill all 64/);
    expect(read("services/api/src/agentApi.ts")).not.toMatch(/the rest are kept for players/);
    expect(read("README.md")).not.toMatch(/Any circuit you own on X Layer can be taught/);
    expect(read("apps/web/src/play/OwnedInstinct.tsx")).not.toMatch(/Any circuit you own on X Layer|任何电路/);
    expect(read("apps/web/src/numbers/NumbersApp.tsx").match(/timeZoneName: "short"/g)?.length, "the numbers page's time says its zone").toBe(2);
    expect(read("scripts/claims-check.mts")).not.toMatch(/here they are only confirmed to exist/);
    expect(read("scripts/judge-check.mts")).not.toMatch(/at empty memory/);
    expect(read("apps/web/src/i18n/strings.ts")).toMatch(/"relay.budgetHour"/);
  });

  it("A102: replaying a pet's thoughts is said to need its log or published diary", () => {
    const landing = read("apps/web/src/landing/copy.ts");
    expect(landing).not.toMatch(/Anyone can replay its thoughts/);
    expect(landing).toMatch(/Once you publish its diary, anyone can replay its thoughts/);
    expect(landing).toMatch(/你公开它的日记之后，任何人都能/);
    const twain = read("packages/world/src/characters.ts");
    expect(twain).toMatch(/Anyone with its log can replay its thoughts/);
    expect(twain).toMatch(/拿到它的日志，谁都可以重放/);
  });

  it("A103: a child is said to be born on chain only when both parents are kept there", () => {
    const landing = read("apps/web/src/landing/copy.ts");
    expect(landing).not.toMatch(/wired together on chain|在链上连接而成/);
    expect(landing).toMatch(/on chain when both parents are kept there/);
    expect(landing).toMatch(/父母都在链上时，它就在链上出生/);
  });

  it("A104 and A105: the settled rule and Slither's finding are said as they are", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/three days and three saves/);
    expect(readme).toMatch(/three days lived and a saved day 3 or later, so one save can be enough/);
    expect(readme).not.toMatch(/Slither found nothing in any of them that needed a fix/);
    expect(readme).toMatch(/Slither found one issue that needed a fix, in the first OutfitMarket/);
  });

  it("A107: the Cardputer is said to be untried on a real device, in the README and beside its option", () => {
    expect(read("README.md")).not.toMatch(/or flashed to a real Cardputer over USB\./);
    expect(read("README.md")).toMatch(/it has not yet been run on one/);
    const panel = read("apps/web/src/play/Handheld.tsx");
    expect(panel).toMatch(/it has not yet been run on a real Cardputer/);
    expect(panel).toMatch(/还没有在真正的 Cardputer 上运行过/);
  });

  it("A108: the proof page's sources say which checks come through Lingxi's server", () => {
    const sources = read("apps/web/src/verify/Endpoints.tsx");
    expect(sources).not.toMatch(/Every check on this page reads X Layer from your browser/);
    expect(sources).not.toMatch(/本页每一项核对都由你的浏览器直接读取/);
    expect(sources).toMatch(/Three things come from Lingxi's server instead/);
    expect(sources).toMatch(/有三样东西来自灵犀的服务器/);
  });

  it("A110: outfits, the season keepsake, the e2e list and the teach demo are said as they are", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/Twelve outfits/);
    expect(readme).toMatch(/<!--f:wearables-->\d+<!--\/f--> pieces to wear/);
    expect(readme).not.toMatch(/seasons whose champion's brain/);
    expect(readme).toMatch(/best-placed pet proven to be on X Layer has its brain taped out/);
    expect(readme).not.toMatch(/\(listed here;/);
    expect(read("scripts/claims-check.mts")).not.toMatch(/a cent is far above this at any OKB price/);
    const demo = read("apps/web/src/landing/LandingApp.tsx");
    expect(demo).toMatch(/Pet School lessons: the words and the rule are written together/);
    expect(demo).toMatch(/宠物学堂的课：话和规则是一起写好的/);
  });

  it("A128 and A129: the README's opening and the mail say replaying needs the log, and who gets the keepsake", () => {
    const readme = read("README.md");
    const mail = read("services/api/mail/letters.json");
    for (const text of [readme, mail]) {
      // every "anyone can replay / check" says what it needs
      expect(text).not.toMatch(/(?<!publish its diary, )anyone can (replay|check)/i);
      expect(text).not.toMatch(/(?<!日志或公开的日记，|日记之后，)任何人都能(重放|核对它)/);
    }
    expect(readme).toMatch(/anyone with its log, or its published diary, can replay it/);
    expect(mail).toMatch(/once you publish its diary, anyone can check every thought it had/);
    expect(mail).not.toMatch(/The winner's brain is taped out|冠军的大脑会在 X Layer 上流片/);
    expect(mail).toMatch(/The best-placed pet proven to be on X Layer has its brain taped out/);
  });

  it("A130 and A131: the README says how BEM moves and what an owner can change about a fee", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/all BEM moves straight from the buyer/);
    expect(readme).toMatch(/every BEM fee is burned in the same transaction as its purchase/);
    expect(readme).not.toMatch(/or change a burn\./);
    expect(readme).toMatch(/or send a fee anywhere but the burn address; a fee's size moves only within the bounds listed/);
    expect(read("docs/claims.md")).not.toMatch(/burn shares cannot change/);
  });

  it("A132: the agents page and /api/v1 say what an agent can read, and where the proof data is", () => {
    const page = read("apps/web/src/agents/AgentsApp.tsx");
    const api = read("services/api/src/agentApi.ts");
    expect(page).not.toMatch(/Anything a player can see, an agent can read/);
    expect(page).not.toMatch(/玩家能看到的，智能体都能用普通 HTTP 读到/);
    expect(api).not.toMatch(/Everything a player can see, an agent can read/);
    expect(page).toMatch(/An agent can read any pet kept on X Layer over plain HTTP/);
    expect(page).toMatch(/智能体可以用普通 HTTP 读取任何一只留在 X Layer 上的宠物/);
    expect(api).toMatch(/An agent can read any pet kept on X Layer and its brain netlist/);
  });

  it("A134, A135, A137 and A138: four smaller sentences say what holds", () => {
    expect(read("apps/web/src/i18n/pageMeta.ts")).not.toMatch(/直接从链上读取/);
    expect(read("docs/claims.md")).toMatch(/composed by REF, on chain when both parents are kept there/);
    const readme = read("README.md");
    expect(readme).not.toMatch(/Every one of these numbers is read from X Layer/);
    expect(readme).toMatch(/The prices above are checked against the contracts by the claims sheet/);
    const quest = read("packages/world/src/questline/arc01-first-days.ts");
    expect(quest).not.toMatch(/my whole day on it|上面是我的一整天/);
    expect(quest).toMatch(/a page with my saved day on it/);
  });

  it("A88: the README says what pet #1's home address is, not only that it is pet #1's", () => {
    const row = read("README.md").split("\n").find((l) => l.startsWith("| Containers |")) ?? "";
    expect(row).not.toMatch(/a pet's home is a TapeOut container; pet #1's is/);
    expect(row).toMatch(/container of its brain circuit, once its owner holds that circuit/);
    expect(row).toMatch(/circuit #1, the gentle starter/);
    expect(row).toMatch(/on-chain copy of the site/);
  });

  it("A58: the holder gift is a snapshot for BEM and FAB, not a live balance", () => {
    expect(read("apps/web/src/verify/ContractTable.tsx")).not.toMatch(/checked against balances/);
    expect(read("apps/web/src/verify/ContractTable.tsx")).toMatch(/by a snapshot at a fixed block/);
    expect(read("README.md")).not.toMatch(/Holder outfit for BEM, FAB, Rig and TapeCode-Test1 holders/);
  });
});
