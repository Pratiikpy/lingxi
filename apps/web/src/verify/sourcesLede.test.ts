// @vitest-environment happy-dom
/** A127: the proof page says where its proofs come from as each build does it: the on-chain copy has no server. */
import { describe, expect, it } from "vitest";
import { sourcesLede } from "./Endpoints";

describe("where these proofs come from (A127)", () => {
  it("the live site names its server fallback and what comes through it", () => {
    expect(sourcesLede("en", true)).toMatch(/Lingxi's server only if all of those fail/);
    expect(sourcesLede("en", true)).toMatch(/Three things come from Lingxi's server instead/);
    expect(sourcesLede("zh", true)).toMatch(/有三样东西来自灵犀的服务器/);
  });

  it("the on-chain copy says it has no server, asks Sourcify directly and reads history and diary from the indexer", () => {
    for (const lang of ["en", "zh"] as const) {
      const said = sourcesLede(lang, false);
      expect(said).not.toMatch(/only if all of those fail|全部失败时才会问灵犀的服务器/);
      expect(said).toMatch(lang === "en" ? /has no server to fall back on/ : /没有可以退回去问的服务器/);
      expect(said).toMatch(lang === "en" ? /asked of Sourcify directly/ : /直接询问 Sourcify/);
      expect(said).toMatch(lang === "en" ? /Lingxi's indexer/ : /灵犀的索引服务/);
    }
  });
});
