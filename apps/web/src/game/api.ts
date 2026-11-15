/** Calls to Lingxi's own server (web build). The DeWEB build never sets an API address. */
import type { Rule } from "@lingxi/brain";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");

export type TeachResponse =
  | { ok: true; rule: Rule; gates: number; reply: { en: string; zh: string } }
  | { ok: false; reason: string; reply?: { en: string; zh: string }; detail?: string };

let health: Promise<boolean> | null = null;
export function teachingAvailable(): Promise<boolean> {
  if (!BASE) return Promise.resolve(false);
  health ??= fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json() as Promise<{ teach?: boolean }>)
    .then((j) => j.teach === true)
    .catch(() => false);
  return health;
}

export async function teachInWords(body: { words: string; name: string; line: string; stage: string; lessons: Rule[] }): Promise<TeachResponse> {
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

export type RelayResponse = { ok: true; processor: string; brainId: string; reused: boolean } | { ok: false; reason: string; detail?: string };

export async function relayBrain(body: { line: string; lessons: Rule[]; instincts?: number }): Promise<RelayResponse> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}/api/tapeout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    return (await r.json()) as RelayResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Tape out a child's brain: REFs to two parent circuits, or both halves of a taught child (its card). */
export async function relayChild(body: { parents: [string, string] } | { card: string }): Promise<RelayResponse> {
  if (!BASE) return { ok: false, reason: "offline" };
  try {
    const r = await fetch(`${BASE}/api/tapeout-child`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    return (await r.json()) as RelayResponse;
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/** Whether this build has a server that can tape out brains for free (the on-chain build has none). */
export const relayAvailable = (): boolean => BASE !== "";
