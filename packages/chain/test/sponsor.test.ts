import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { signSponsorRequest, sponsorMessage, sponsorSigner } from "../src/sponsor";

describe("a sponsored hatch request (H4)", () => {
  it("is signed by the device key it names, and the signature names that key back", async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const { request, signature } = await signSponsorRequest(key, { line: "gentle", state: "123", at: 1_000 });
    expect(request.to).toBe(key.address);
    expect(await sponsorSigner(request, signature)).toBe(key.address);
  });
  it("names someone else once any part is changed, and nobody for junk", async () => {
    const key = privateKeyToAccount(generatePrivateKey());
    const { request, signature } = await signSponsorRequest(key, { line: "gentle", state: "123", at: 1_000 });
    for (const changed of [
      { ...request, line: "bold" as const },
      { ...request, state: "124" },
      { ...request, at: 1_001 },
    ])
      expect(await sponsorSigner(changed, signature)).not.toBe(key.address);
    expect(await sponsorSigner(request, "0x1234")).toBeNull();
    expect(await sponsorSigner({ ...request, to: "0xnope" as never }, signature)).toBeNull();
  });
  it("says what it asks for in plain words, lower-case address", () => {
    expect(sponsorMessage({ to: "0x00000000000000000000000000000000000000AA", line: "bold", state: "9", at: 5 })).toBe(
      "Lingxi: keep my pet on X Layer for me\naddress 0x00000000000000000000000000000000000000aa\nline bold\nstate 9\nat 5",
    );
  });
});
