import { describe, expect, it } from "vitest";
import { retryNote, steadyFetch } from "./steadyFetch.mts";

/** A site that answers with the given statuses in turn ("timeout" throws as a timed-out request does). */
function site(...answers: Array<number | "timeout">) {
  let asked = 0;
  const fetchFn = async () => {
    const a = answers[Math.min(asked++, answers.length - 1)]!;
    if (a === "timeout")
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    return new Response("ok", { status: a });
  };
  return { fetchFn, asked: () => asked, sleep: async () => undefined };
}

describe("reading the live site through one hiccup (A5)", () => {
  it("tries again after a passing edge error, and says that it did", async () => {
    const s = site(520, 200);
    const { res, retried } = await steadyFetch("https://x/verify.html", s);
    expect(res.status).toBe(200);
    expect(retried).toEqual(["520"]);
    expect(retryNote("verify.html", retried)).toBe("verify.html needed a retry (520)");
  });

  it("fails when every try hiccups, naming each answer", async () => {
    const s = site(520, 522, 520, 520);
    await expect(steadyFetch("https://x/verify.html", s)).rejects.toThrow(
      "https://x/verify.html: 520, then 522, then 520, then 520",
    );
    expect(s.asked()).toBe(4);
  });

  it("counts any other answer at once, a 404 included, with no retry", async () => {
    const s = site(404, 200);
    const { res, retried } = await steadyFetch("https://x/gone.html", s);
    expect(res.status).toBe(404);
    expect(retried).toEqual([]);
    expect(s.asked()).toBe(1);
    expect(retryNote("gone.html", retried)).toBe("");
  });

  it("treats a timed-out request as a hiccup too", async () => {
    const s = site("timeout", "timeout", 200);
    const { res, retried } = await steadyFetch("https://x/api/health", s);
    expect(res.status).toBe(200);
    expect(retried).toEqual(["timeout", "timeout"]);
  });
});
