// @vitest-environment happy-dom
/**
 * C5: the circuit catalogue page (circuits.html, which uses none of the game's code) asks X Layer one request at
 * a time. A public node turns away requests that pile up; pressing every circuit's check at once used to send them all
 * together, and every check said X Layer could not be reached. Here the page's own script runs against a node that
 * refuses any request arriving while another is in flight.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = join(import.meta.dirname, "..");
const pub = join(web, "public");
const html = readFileSync(join(web, "circuits.html"), "utf8");
const catalogue = readFileSync(join(pub, "circuits.json"), "utf8");
const word = (n: number) => n.toString(16).padStart(64, "0");
/** an ABI answer holding one or two `bytes` of one zero byte each */
const answer = "0x" + word(64) + word(128) + word(1) + "00".padEnd(64, "0") + word(1) + "00".padEnd(64, "0");

function load(language = "en"): { refused: number } {
  const seen = { refused: 0 };
  let inFlight = 0;
  const fakeFetch = async (url: string, init?: { body?: string }) => {
    if (String(url).endsWith("circuits.json")) return { json: async () => JSON.parse(catalogue) };
    if (inFlight > 0) {
      seen.refused++;
      return {
        json: async () => ({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "too many requests" } }),
      };
    }
    inFlight++;
    await new Promise((r) => setTimeout(r, 3));
    inFlight--;
    const calls = JSON.parse(init?.body ?? "[]") as Array<{ id: number }>;
    return { json: async () => calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: answer })) };
  };
  // the page's own script is what is tested; its stylesheet is left out (this DOM loads no CSS, and said so in CI's log)
  document.documentElement.innerHTML = html
    .replace(/<script>[\s\S]*<\/script>/, "")
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/g, "");
  const code = html.match(/<script>([\s\S]*)<\/script>/)![1]!;
  new Function("fetch", "document", "navigator", code)(fakeFetch, document, { language });
  return seen;
}

describe("the circuit catalogue page asks X Layer one request at a time (C5)", () => {
  it("every check pressed at once gets its answer; none is turned away", async () => {
    const seen = load();
    const checks = () =>
      Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Check every vector on X Layer");
    // the page renders once circuits.json is read: wait for its buttons
    for (let waited = 0; checks().length === 0 && waited < 10_000; waited += 20)
      await new Promise((r) => setTimeout(r, 20));
    const buttons = checks();
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) b.click();
    // wait for every check's answer (or a refusal), never a fixed time: under load the queue takes longer
    const settled = () =>
      ((document.body.textContent ?? "").match(/vectors agree with X Layer|could not be reached/g) ?? []).length >=
      buttons.length;
    for (let waited = 0; !settled() && waited < 50_000; waited += 50) await new Promise((r) => setTimeout(r, 50));
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/could not be reached/);
    expect(text.match(/vectors agree with X Layer/g)?.length).toBe(buttons.length);
    expect(seen.refused, "no request arrived while another was in flight").toBe(0);
  }, 60_000);
});

describe("the circuit cards' fold-out shows that it opens (R68)", () => {
  it("'What each bit means' keeps its open marker: the page's stylesheet keeps a summary a list item", () => {
    const css = readFileSync(join(web, "src", "static", "circuits.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const summaries = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => m[1]!.split(",").some((s) => /summary\s*$/.test(s.trim())))
      .map((m) => ({ selector: m[1]!.trim(), display: /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim() }));
    expect(summaries.length, "the page styles its summaries").toBeGreaterThan(0);
    expect(summaries.filter((s) => s.display && s.display !== "list-item")).toEqual([]);
  });
});

describe("the circuits page in Chinese reads in Chinese (R75)", () => {
  /** Waits for the page's catalogue, presses a card's run, and gives the card's answer once it has come. */
  async function run(card: Element): Promise<string> {
    const out = card.querySelector("p[aria-live]");
    card.querySelector<HTMLButtonElement>("button.cx-run")?.click();
    for (let waited = 0; /^…?$/.test(out?.textContent ?? "") && waited < 10_000; waited += 20)
      await new Promise((r) => setTimeout(r, 20));
    return out?.textContent ?? "";
  }

  it("a rule's name, its fields and its run's answer are in Chinese, as are a brain's memory and the chain", async () => {
    load("zh-CN");
    for (let waited = 0; !document.querySelector("#rules .card") && waited < 10_000; waited += 20)
      await new Promise((r) => setTimeout(r, 20));
    const drop = document.querySelector("#rule-drop")!;
    expect(drop.querySelector("h3")?.textContent).toBe("找东西（drop）· 电路 #7");
    const fields = Array.from(drop.querySelectorAll("table td:first-child"), (td) => td.textContent);
    expect(fields).toContain("稀有度（tier）");
    const answer = await run(drop);
    expect(answer).toMatch(
      /输入 1（稀有度 1 · 房间相合 0） → X Layer 的答案 0（权重指数 0 · 有权重 0 · 稀有 0 · 熟悉度 0）/,
    );
    expect(answer).not.toMatch(/tier|home|exponent|weighted|rare|familiarity/);
    expect(document.getElementById("rule-folk:wick")?.querySelector("h3")?.textContent).toMatch(
      /^居民问候 · 灯芯（folk:wick）/,
    );
    const brain = document.querySelector("#brains .card")!;
    expect(brain.textContent).toMatch(/记忆 8 位（信任 0-2，喜欢玩具 3，还在害怕 4，醒了 5-7）/);
    expect(await run(brain)).toMatch(/下一刻的记忆 0（信任 0 · 喜欢玩具 0 · 还在害怕 0 · 醒了 0）/);
    expect(document.querySelector("#proc")?.textContent).toMatch(/· 链 196$/);
    const trust = await run(document.querySelector("#rule-trust")!);
    expect(trust).toMatch(
      /^输入 \d+（信任点数 \d+ · 口味 \d · 今天已算过 \d） → X Layer 的答案 0（信任等级 0 · 加的点数 0 · 被拒收 0）/,
    );
  });
});
