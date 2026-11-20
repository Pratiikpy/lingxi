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
    expect(home.match(/planned over TapeRelay/g)?.length, "every state says Lingxi does not send them yet").toBe(3);
    expect(read("README.md")).not.toMatch(/until the hub accepts circuits from Lingxi's processor/);
    expect(read("README.md")).toMatch(/the hub runs code TapeKit has not approved/);
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
