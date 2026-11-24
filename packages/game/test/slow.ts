/**
 * P6b: a long test's time limit, scaled when the run is slowed on purpose. Coverage instruments every line and makes
 * the simulation tests several times slower; scripts/coverage.mts sets LINGXI_SLOW_TESTS so their limits grow with it,
 * while a plain run keeps the limits as written.
 */
export const slow = (ms: number): number => ms * (Number(process.env.LINGXI_SLOW_TESTS) || 1);
