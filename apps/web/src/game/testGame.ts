/**
 * A visit to the play page, for the store tests: storage as the browser keeps it, the device clock and the network are
 * the test's, and the page claims the game (saveRuntime) before any store reads its save, as play/main.tsx does. Every
 * module is loaded anew on each visit, so a visit starts from what storage holds, exactly as a reload does.
 */

import { type ReactElement, act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { memoryStorage } from "./testStorage";

export type Storage = ReturnType<typeof memoryStorage>;
export type Net = (url: string, init?: RequestInit) => Promise<Response>;

/** A network that never answers: every request fails as a browser's does offline. */
export const offline: Net = async () => {
  throw new TypeError("Failed to fetch");
};

/** A JSON answer, as a server sends one. */
export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** What a page put on `window` and `document`, taken down when the page goes, so an old page never hears a new one's events. */
let listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject | null]> = [];

function track(): void {
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
      listeners.push([target, type, fn]);
      if (fn) add(type, fn, opts);
    });
  }
}
// from the start, so a page a test file loads with its own imports (a screen's module) is taken down at the first visit
track();

function leavePage(): void {
  for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
  listeners = [];
  vi.restoreAllMocks();
  track();
}

export interface VisitOptions {
  /** the device clock as the page opens (ms since the epoch) */
  at: number;
  /** the browser's storage; a reload passes the one the last visit left */
  storage?: Storage;
  /** characters a new storage holds before it is full */
  limit?: number;
  /** answers the page's requests; offline by default */
  net?: Net;
  /** claim the game for this tab before the stores load (the play page always does) */
  claim?: boolean;
  /** what the page finds as `localStorage` instead of `storage`: a browser that blocks it, or has none */
  localStorage?: unknown;
}

/** Opens the play page: fresh modules, fake timers at `at`, storage and network in place, the game claimed. */
export async function visit(o: VisitOptions) {
  leavePage();
  vi.resetModules();
  vi.useFakeTimers({ now: o.at, toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const storage = o.storage ?? memoryStorage(o.limit);
  vi.stubGlobal("localStorage", "localStorage" in o ? o.localStorage : storage);
  const net = vi.fn(o.net ?? offline);
  vi.stubGlobal("fetch", net);
  const runtime = await import("./saveRuntime");
  const claimed = o.claim === false ? null : await runtime.claimTheGame();
  return { storage, net, runtime, claimed };
}

/** The page reloads: it gives its place up as it goes (pagehide), and the next visit reads what storage now holds. */
export async function reload(storage: Storage, o: Omit<VisitOptions, "storage">) {
  window.dispatchEvent(new Event("pagehide"));
  return visit({ ...o, storage });
}

/** Lets fake time run until `p` settles (retries and polling wait on timers), then returns what it settled to. */
export async function settle<T>(p: Promise<T>, stepMs = 250, maxSteps = 400): Promise<T> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < maxSteps && !done; i++) await vi.advanceTimersByTimeAsync(stepMs);
  return p;
}

/** Puts a screen on the page, as the player sees it: React renders it into the document, and `text()` reads what it shows. */
export async function show(element: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    text: () => host.textContent ?? "",
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Ends a visit: real timers and the real globals back. */
export function leave(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
  listeners = [];
  vi.restoreAllMocks();
}
