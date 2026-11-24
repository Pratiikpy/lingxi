/** Calls to Lingxi's own server (web build). The DeWEB build never sets an API address. */
import type { RelayEnvelopeOf, RelayPayloads, TeachBody } from "@lingxi/api-schema";
import type { Rule } from "@lingxi/brain";
import { type SignedRelay, signRelay } from "@lingxi/chain";

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (location.hostname === "localhost" ? "http://localhost:8787" : "");

export type TeachResponse =
  | { ok: true; rule: Rule; gates: number; reply: { en: string; zh: string } }
  | { ok: false; reason: string; reply?: { en: string; zh: string }; detail?: string };

/**
 * Whether teaching in words is on offer, and if not, why (H11): the on-chain copy has no server (it is not offline, and
 * says so), a device with no connection is offline, and a server that does not answer is told from one that has teaching
 * switched off.
 */
export type TeachingState = "ready" | "noServer" | "offline" | "unreachable" | "off";

export async function readTeachingState(
  base: string,
  online: boolean,
  get: typeof fetch = fetch,
): Promise<TeachingState> {
  if (!base) return "noServer";
  if (!online) return "offline";
  let r: Response;
  try {
    r = await get(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
  } catch {
    return "unreachable";
  }
  try {
    return ((await r.json()) as { teach?: boolean } | null)?.teach === true ? "ready" : "off";
  } catch {
    return "off";
  }
}

let state: Promise<TeachingState> | null = null;
/** Asked once per visit; a visit that could not reach the server asks again next time the screen opens. */
export function teachingState(): Promise<TeachingState> {
  const asking = (state ??= readTeachingState(BASE, typeof navigator === "undefined" || navigator.onLine !== false));
  void asking.then((s) => {
    if (s === "unreachable" || s === "offline") state = null;
  });
  return asking;
}

/** Teaching in plain words; build the body with requests.ts teachBody. */
export async function teachInWords(body: TeachBody): Promise<TeachResponse> {
  try {
    const r = await fetch(`${BASE}/api/teach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return (await r.json()) as TeachResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export type RelayResponse =
  | { ok: true; processor: string; brainId: string; reused: boolean }
  | { ok: false; reason: string; detail?: string };

/**
 * A keeper's signed request for one relay route (see chain.ts relaySigner), its payload that route's own schema: a
 * payload the server would refuse, or one sent to the wrong route, fails the type check.
 */
export const signRelayRequest = <K extends keyof RelayPayloads>(
  signer: Parameters<typeof signRelay>[0],
  kind: K,
  petId: string,
  payload: RelayPayloads[K],
): Promise<SignedRelay<K>> => signRelay(signer, kind, petId, payload);

export async function relayBrain(signed: RelayEnvelopeOf<"brain">): Promise<RelayResponse> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}/api/tapeout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(180_000),
    });
    return (await r.json()) as RelayResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Tape out a child's brain: REFs to two parent circuits, or both halves of a taught child (its card). */
export async function relayChild(signed: RelayEnvelopeOf<"child">): Promise<RelayResponse> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}/api/tapeout-child`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(300_000),
    });
    return (await r.json()) as RelayResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** X1: tape out the circuit that puts an owned instinct beside the pet's own brain. */
export async function relayInstinct(signed: RelayEnvelopeOf<"instinct">): Promise<RelayResponse> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}/api/tapeout-instinct`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(300_000),
    });
    return (await r.json()) as RelayResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Whether this build has a server that can tape out brains for free (the on-chain build has none). */
export const relayAvailable = (): boolean => BASE !== "";
