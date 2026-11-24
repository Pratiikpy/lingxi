/** C2: the team's further wallets, read from a file kept out of the repo; nothing in it can stop the server. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTeamFile } from "../src/team";

const at = (body: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "team-")), "team.json");
  writeFileSync(f, body);
  return f;
};

describe("the team's further wallets (C2)", () => {
  it("reads well-formed addresses, lower-cased and once each", () => {
    expect(
      readTeamFile(
        at(
          JSON.stringify({
            wallets: ["0xCCF02beaaa91068f9173dfacf7b5197f3ed4447c", "0xccf02beaaa91068f9173dfacf7b5197f3ed4447c"],
          }),
        ),
      ),
    ).toEqual(["0xccf02beaaa91068f9173dfacf7b5197f3ed4447c"]);
  });

  it("counts nothing from a missing file, a damaged one, or entries that are not addresses", () => {
    expect(readTeamFile(join(tmpdir(), "no-such-team.json"))).toEqual([]);
    expect(readTeamFile(at("{not json"))).toEqual([]);
    expect(readTeamFile(at(JSON.stringify({ wallets: ["bob", 7, "0x12"] })))).toEqual([]);
  });
});
