import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi, stringToBytes } from "viem";
import { CHUNK_BYTES, homePageHtml, homeSiteName, homeSiteUrl } from "../src/homepage";

const base = {
  petId: 7n,
  name: "Mochi",
  registry: "0x103d7252eb6b2fec22b3f65a6bb605945f280e99" as const,
  rpc: "https://rpc.xlayer.tech",
  proofUrl: "https://lingxi.knole.me/verify.html#7",
  siteName: "12.2.419.tape",
};

describe("a home's own page", () => {
  it("names the site the way TapeKit resolves it", () => {
    expect(homeSiteName(12n, 419)).toBe("12.2.419.tape");
    expect(homeSiteUrl(12n, 419)).toBe("https://12-2-419.tapekit.org/");
  });

  it("reads the right pet from the registry", () => {
    const html = homePageHtml(base);
    const data = /"(0x[0-9a-f]{72})"/.exec(html)![1] as `0x${string}`;
    const d = decodeFunctionData({ abi: parseAbi(["function pet(uint256 petId) view returns (uint256)"]), data });
    expect(d.args[0]).toBe(7n);
    expect(html).toContain(base.registry);
  });

  it("never lets a name, picture or link inject markup", () => {
    const html = homePageHtml({
      ...base,
      name: '<script>alert(1)</script>"x',
      image: "javascript:alert(1)",
      proofUrl: 'javascript:alert(1)"',
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain('<img class="pic"');
  });

  it("keeps a real pet page within two writes", () => {
    const img = `data:image/svg+xml;base64,${"A".repeat(12_000)}`;
    expect(stringToBytes(homePageHtml({ ...base, image: img })).length).toBeLessThan(CHUNK_BYTES * 2);
  });
});
