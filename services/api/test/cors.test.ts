import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";

const from = (origin: string) => ({ headers: { Origin: origin } });

describe("which origins may read which routes", () => {
  const app = createApp(null);

  it("lets any page read a pet's public history and published log (the on-chain copy has no server of its own)", async () => {
    for (const path of ["/api/pets/1/history", "/api/pets/1/log"]) {
      const res = await app.request(path, from("https://1-2-419.tapekit.org"));
      expect(res.headers.get("access-control-allow-origin"), path).toBe("*");
    }
  });

  it("keeps the game's own routes to the game's pages", async () => {
    const res = await app.request("/api/health", from("https://elsewhere.example"));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never opens writes to every origin", async () => {
    const res = await app.request("/api/pets/1/history", { method: "POST", ...from("https://elsewhere.example") });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
