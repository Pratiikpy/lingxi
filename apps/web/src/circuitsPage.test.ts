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

function load(): { refused: number } {
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
  document.documentElement.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, "");
  const code = html.match(/<script>([\s\S]*)<\/script>/)![1]!;
  new Function("fetch", "document", "navigator", code)(fakeFetch, document, { language: "en" });
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
