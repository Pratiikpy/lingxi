import { describe, expect, it } from "vitest";
import { LINGXI_SITE, sitePage } from "../src/site";

describe("the public site, named once (P7)", () => {
  it("links a page with one slash, whether or not the path starts with one", () => {
    expect(sitePage("verify.html#7")).toBe(`${LINGXI_SITE}/verify.html#7`);
    expect(sitePage("/tree.html")).toBe(`${LINGXI_SITE}/tree.html`);
    expect(LINGXI_SITE.endsWith("/")).toBe(false);
  });
});
