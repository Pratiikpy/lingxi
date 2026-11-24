/** A71: Sourcify's verdict on the deployment's contracts, relayed so an outage reaches the page as words. */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createSourcifyRelay, withSourcify } from "../src/sourcify";

const A = "0x103d7252eb6b2fec22b3f65a6bb605945f280e99";
const B = "0x8da8221466de12321e6ee2ea73d62aaf28bb11b0";
const STRANGER = "0x1111111111111111111111111111111111111111";

/** A Sourcify that answers each address as told, counting what it was asked. */
function sourcify(answers: Record<string, () => Promise<Response> | Response>) {
  const asked: string[] = [];
  const fetcher = (async (url: string | URL) => {
    const address = String(url).split("/").pop()!.toLowerCase();
    asked.push(address);
    const a = answers[address];
    if (!a) return new Response("", { status: 404 });
    return a();
  }) as typeof fetch;
  return { fetcher, asked };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the Sourcify relay (A71)", () => {
  it("words each kind of answer as the page does", async () => {
    const C = "0x2222222222222222222222222222222222222222";
    const D = "0x3333333333333333333333333333333333333333";
    const E = "0x4444444444444444444444444444444444444444";
    const s = sourcify({
      [A]: () => json({ match: "exact_match", creationMatch: "exact_match", runtimeMatch: "exact_match" }),
      [B]: () => json({ match: "match", creationMatch: null, runtimeMatch: "match" }),
      [C]: () => new Response("bad gateway", { status: 502 }),
      [D]: () => new Response("<html>not json</html>", { status: 200 }),
      [E]: () => new Promise<Response>(() => undefined),
    });
    const relay = createSourcifyRelay({ allowed: [A, B, C, D, E, STRANGER], fetch: s.fetcher, timeoutMs: 50 });
    expect(await relay.state(A)).toBe("exact");
    expect(await relay.state(B)).toBe("partial");
    expect(await relay.state(STRANGER), "Sourcify's 404: not verified").toBe("none");
    expect(await relay.state(C)).toBe("unreachable");
    expect(await relay.state(D)).toBe("unreachable");
    expect(await relay.state(E), "past its time limit").toBe("unreachable");
  });

  it("keeps an answer ten minutes and a failure one, and asks once per address at a time", async () => {
    let now = 1_000_000;
    let up = false;
    const s = sourcify({
      [A]: () =>
        up
          ? json({ match: "exact_match", creationMatch: "exact_match", runtimeMatch: "exact_match" })
          : new Response("", { status: 503 }),
    });
    const relay = createSourcifyRelay({ allowed: [A], fetch: s.fetcher, now: () => now });
    const [x, y] = await Promise.all([relay.state(A), relay.state(A)]);
    expect([x, y]).toEqual(["unreachable", "unreachable"]);
    expect(s.asked, "two pages at once, one question").toHaveLength(1);
    up = true;
    now += 30_000;
    expect(await relay.state(A), "a failure is kept a minute").toBe("unreachable");
    now += 31_000;
    expect(await relay.state(A), "then asked again").toBe("exact");
    now += 9 * 60_000;
    up = false;
    expect(await relay.state(A), "an answer is kept ten minutes").toBe("exact");
    expect(s.asked).toHaveLength(2);
  });

  it("answers over HTTP for the deployment's contracts only", async () => {
    const s = sourcify({
      [A]: () => json({ match: "exact_match", creationMatch: "exact_match", runtimeMatch: "exact_match" }),
    });
    const app = withSourcify(new Hono(), createSourcifyRelay({ allowed: [A], fetch: s.fetcher }));
    expect(await (await app.request(`/api/sourcify/${A.toUpperCase().replace("0X", "0x")}`)).json()).toEqual({
      ok: true,
      address: A,
      state: "exact",
    });
    const stranger = await app.request(`/api/sourcify/${STRANGER}`);
    expect(stranger.status, "never an open proxy").toBe(404);
    expect((await app.request("/api/sourcify/0x12")).status).toBe(400);
    expect(s.asked).toEqual([A]);
  });
});
