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

/**
 * A factory and its processors, as X Layer answers: a processor's `nextId` is the id of its latest circuit (ids start
 * at 1, so a processor with three circuits answers 3; read back on mainnet, C1). `fail` names netlist reads that fail
 * (as "cpu:id"), and `deaf` processors whose nextId cannot be read.
 */
function fakeChain(circuits: Record<string, string[]>, o: { fail?: Set<string>; deaf?: Set<string> } = {}) {
  const cpus = [OURS, OTHER, THIRD];
  const latest = (a: string) => BigInt((circuits[a.toLowerCase()] ?? []).length);
  return {
    reads: 0,
    readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "cpuCount") return BigInt(cpus.length);
      if (functionName === "cpuAt") return cpus[Number(args![0])];
      if (functionName === "nextId") return latest(address);
      throw new Error(functionName);
    },
    multicall: async ({ contracts, allowFailure }: { contracts: Array<{ address: string; functionName: string; args?: readonly unknown[] }>; allowFailure: boolean }) =>
      contracts.map((c) => {
        const a = c.address.toLowerCase();
        const failed = (c.functionName === "nextId" && o.deaf?.has(a)) || (c.functionName === "netlist" && o.fail?.has(`${a}:${Number(c.args![0])}`));
        const id = c.functionName === "netlist" ? Number(c.args![0]) : 0;
        // a netlist past the latest id reverts, as on chain
        if (c.functionName === "netlist" && id > (circuits[a]?.length ?? 0)) return allowFailure ? { status: "failure", error: new Error("revert") } : (() => { throw new Error("revert"); })();
        if (failed) return { status: "failure", error: new Error("timeout") };
        const result = c.functionName === "cpuAt" ? cpus[Number(c.args![0])] : c.functionName === "nextId" ? latest(a) : circuits[a]![id - 1];
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

  it("reads each processor's newest circuit: nextId is the latest id, not the next (C1)", async () => {
    // the only circuit on a new processor, and the newest of another: both REF ours, and both are found
    const circuits: Record<string, string[]> = { [OURS]: [plain], [OTHER]: [withRef(OURS, 3)], [THIRD]: [plain, plain, withRef(OURS, 1)] };
    const scan = createRefScanner({ client: fakeChain(circuits) as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS });
    await scan.catchUp();
    expect(scan.list().map((r) => `${r.cpu}:${r.id}`).sort()).toEqual([`${OTHER}:1`, `${THIRD}:3`]);
    expect(scan.totals().complete).toBe(true);
  });

  it("never steps past a netlist it could not read, and reads it on the next pass (C1)", async () => {
    const circuits: Record<string, string[]> = { [OURS]: [plain], [OTHER]: [plain, withRef(OURS, 4), withRef(OURS, 5)], [THIRD]: [] };
    const store = join(mkdtempSync(join(tmpdir(), "lx-refs-")), "refs.json");
    const flaky = createRefScanner({ client: fakeChain(circuits, { fail: new Set([`${OTHER}:2`]) }) as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS, store });
    await flaky.catchUp();
    expect(flaky.totals().complete, "a failed read leaves the walk unfinished").toBe(false);
    const healed = createRefScanner({ client: fakeChain(circuits) as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS, store });
    await healed.catchUp();
    expect(healed.list().map((r) => `${r.cpu}:${r.id}`).sort()).toEqual([`${OTHER}:2`, `${OTHER}:3`]);
    expect(healed.totals().complete).toBe(true);
  });

  it("is not complete while a processor's nextId cannot be read (C1)", async () => {
    const circuits: Record<string, string[]> = { [OURS]: [plain], [OTHER]: [plain], [THIRD]: [withRef(OURS, 1)] };
    const scan = createRefScanner({ client: fakeChain(circuits, { deaf: new Set([THIRD]) }) as never, factory: "0x0000000000000000000000000000000000000fac", ours: OURS });
    await scan.catchUp();
    expect(scan.totals().complete).toBe(false);
  });
});
