/**
 * What the handheld's self-test compares against, recorded from X Layer when the firmware was built
 * (`scripts/build-selftest.ts` refuses to build if the compiled netlists hash otherwise, and writes these into the
 * firmware). The firmware cannot read the chain; the browser handheld reads X Layer and confirms them live (A59).
 */

/** keccak-256 of each starter's netlist on X Layer (circuits 1, 2, 3 of processor 0xf70d…3c4e) */
export const RECORDED_STARTERS = {
  gentle: "0xab2d7b0e5c8eeb1fcdf6f0225b6dd912459a26b6fcc73f86d5470152a18a1e47",
  bold: "0x085d9b6352bf1cd5f06061c948f48787db58469454558f627a198569d55b24cd",
  curious: "0x372b08dab3d43d9d14e0f4c8884c8063d978264abbc1fe4261c8d25eb8064a7a",
} as const;
