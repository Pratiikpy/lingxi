/**
 * X Layer clients that cost nothing until they are used (P3). `viem()` loads viemRuntime.ts once; `lazyPublicClient`
 * returns a client whose every method waits for that load, builds the real client once, and calls it, so the rest of
 * the game keeps calling `publicClient.readContract(...)` as before. Every public client method is asynchronous, which
 * is what lets a stand-in forward it; nothing in the game reads a client's plain fields (checked when this was built).
 */
import type { PublicClient } from "viem";
import { warmLater } from "./warm";

type Runtime = typeof import("./viemRuntime");

let runtime: Promise<Runtime> | null = null;

/** The client-building half of viem, loaded once. */
export function viem(): Promise<Runtime> {
  return (runtime ??= import("./viemRuntime"));
}
// fetched in the play page's warm-up, so the first read of X Layer does not wait on it
warmLater(viem);

/** A public client built from `make` the first time one of its methods is called. */
export function lazyPublicClient(make: (v: Runtime) => PublicClient): PublicClient {
  let real: Promise<PublicClient> | null = null;
  const client = () => (real ??= viem().then(make));
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy({} as PublicClient, {
    get(_, prop) {
      // a stand-in is not a promise: awaiting it must not look for `then`
      if (prop === "then") return undefined;
      if (!methods.has(prop)) {
        methods.set(prop, async (...args: unknown[]) => {
          const c = (await client()) as unknown as Record<PropertyKey, unknown>;
          const f = c[prop];
          if (typeof f !== "function") throw new Error(`the X Layer client has no method ${String(prop)}`);
          return (f as (...a: unknown[]) => unknown).apply(c, args);
        });
      }
      return methods.get(prop);
    },
  });
}
