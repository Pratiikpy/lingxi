/**
 * H6: "used by others", counted from chain. The scanner walks every processor TapeOut's factory knows, reads each new
 * circuit's netlist and keeps the ones on other processors that REF a Lingxi circuit; progress is kept, so a later pass
 * reads only circuits made since.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRefScanner, refTargets } from "../src/refScan";

const OURS = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000bb";
const THIRD = "0x00000000000000000000000000000000000000cc";

/** A netlist: a NAND, then a REF to `cpu` circuit `id` with two inputs and one output. */
function withRef(cpu: string, id: number): string {
  const nand = "01" + "000002" + "000003";
  const idHex = id.toString(16).padStart(16, "0");
  return "0x" + nand + "02" + cpu.slice(2) + idHex + "02" + "01" + "000002" + "000003";
}
const plain = "0x01000002000003";

function fakeChain(circuits: Record<string, string[]>) {
  const cpus = [OURS, OTHER, THIRD];
  return {
    reads: 0,
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "cpuCount") return BigInt(cpus.length);
      if (functionName === "cpuAt") return cpus[Number(args![0])];
      if (functionName === "nextId") return BigInt((circuits[address.toLowerCase()] ?? []).length + 1);
      throw new Error(functionName);
    },
    multicall: async ({ contracts, allowFailure }: { contracts: Array<{ address: string; functionName: string; args?: readonly unknown[] }>; allowFailure: boolean }) =>
      contracts.map((c) => {
        const result =
          c.functionName === "cpuAt" ? cpus[Number(c.args![0])] : c.functionName === "nextId" ? BigInt((circuits[c.address.toLowerCase()] ?? []).length + 1) : circuits[c.address.toLowerCase()]![Number(c.args![0]) - 1];
        return allowFailure ? { status: "success", result } : result;
      }),
  };
}

describe("circuits on other processors that use Lingxi's (H6)", () => {
  it("reads the REFs in a netlist", () => {
    expect(refTargets(withRef(OURS, 8))).toEqual([{ cpu: OURS, id: 8n }]);
    expect(refTargets(plain)).toEqual([]);
    expect(refTargets("0xff")).toEqual([]);
  });

  it("counts only circuits on other processors that REF ours, and reads only new circuits on a later pass", async () => {
    const circuits: Record<string, string[]> = {
      [OURS]: [withRef(OURS, 1)],
      [OTHER]: [plain, withRef(OURS, 8), withRef(THIRD, 2)],
      [THIRD]: [withRef(OURS, 7)],
    };
    const chain = fakeChain(circuits);
    const store = join(mkdtempSync(join(tmpdir(), "lx-refs-")), "refs.json");
    const scan = createRefScanner({ client: chain as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS, store });
    await scan.catchUp();
    expect(scan.totals()).toMatchObject({ circuits: 2, processors: 2, scannedProcessors: 2, cpuCount: 3, complete: true });
    expect(scan.list().map((r) => `${r.cpu}:${r.id}->${r.target}`).sort()).toEqual([`${OTHER}:2->8`, `${THIRD}:1->7`]);
    circuits[OTHER]!.push(withRef(OURS, 9));
    const again = createRefScanner({ client: chain as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS, store });
    await again.catchUp();
    expect(again.totals()).toMatchObject({ circuits: 3, processors: 2 });
  });
});
