/**
 * Counting steps on a phone (PRD W4) from the device's motion sensor: the
 * acceleration's magnitude is smoothed and each rise through a threshold, at
 * least a third of a second after the last, is a step. iOS asks the player's
 * permission first. A device whose sensor sends nothing within a moment is
 * treated as having none, and the walk counts minutes instead.
 */

const SMOOTH = 0.2;
const RISE = 1.6;
const MIN_GAP_MS = 330;
const PROBE_MS = 1500;

type MotionPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

/** Asks for motion access where the browser requires it (iOS); true when motion may be read. */
export async function allowMotion(): Promise<boolean> {
  const D = (globalThis as { DeviceMotionEvent?: MotionPermission }).DeviceMotionEvent;
  if (!D) return false;
  if (typeof D.requestPermission === "function") {
    try {
      return (await D.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

/** Whether real acceleration readings arrive within a moment. */
export function probeMotion(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return resolve(false);
    const on = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (a && (a.x ?? null) !== null && (a.y ?? null) !== null && (a.z ?? null) !== null) {
        window.removeEventListener("devicemotion", on);
        clearTimeout(t);
        resolve(true);
      }
    };
    const t = setTimeout(() => {
      window.removeEventListener("devicemotion", on);
      resolve(false);
    }, PROBE_MS);
    window.addEventListener("devicemotion", on);
  });
}

/** Starts counting; calls back with each batch of new steps. Returns a stop function. */
export function countSteps(onSteps: (n: number) => void): () => void {
  let base = 9.81;
  let above = false;
  let last = 0;
  let pending = 0;
  const on = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    base = base + SMOOTH * 0.05 * (mag - base);
    const t = performance.now();
    if (!above && mag > base + RISE && t - last > MIN_GAP_MS) {
      above = true;
      last = t;
      pending++;
    } else if (above && mag < base) above = false;
  };
  const flush = setInterval(() => {
    if (pending) {
      onSteps(pending);
      pending = 0;
    }
  }, 2000);
  window.addEventListener("devicemotion", on);
  return () => {
    window.removeEventListener("devicemotion", on);
    clearInterval(flush);
    if (pending) onSteps(pending);
  };
}
