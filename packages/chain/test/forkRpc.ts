/**
 * P7c: how the chain package's fork tests talk to their fork. A fork answers what it already holds at once, but a first
 * read of a large contract's storage (a processor's netlist, hundreds of slots) is fetched from X Layer one slot at a
 * time, and once ran past viem's default 10 s on a cold fork ("The request took too long to respond", fork.test.ts,
 * netlist(1)). Each request waits up to two minutes and is sent once: a retried read only doubles the load on an
 * endpoint that is already slow, as the browser suite found (e2e/helpers/chain.ts, 60 s and no retries).
 */
import { http } from "viem";

/** The longest a fork test waits for one answer from its fork. */
export const FORK_TIMEOUT_MS = 120_000;

/** The transport every fork test uses for its fork; a test with one known heavy read may wait longer. */
export const forkHttp = (url: string | undefined, timeout = FORK_TIMEOUT_MS) => http(url, { timeout, retryCount: 0 });
