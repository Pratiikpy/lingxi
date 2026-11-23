/**
 * A panel drawn only once it comes near the screen (PRD R5): long sheets open at
 * once on slow phones instead of building every panel, and anything below stays
 * a light placeholder until it is scrolled to.
 */

import { type ComponentType, type ReactElement, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";

export function Lazy({ children, height = 240 }: { children: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // a browser that cannot tell when it is near draws it at once
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), { root: el.closest(".sheet") ?? null, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  const hold = <div ref={ref} className="lazy-hold" style={{ minHeight: height }} aria-hidden="true" />;
  // P3: a panel whose code is itself loaded lazily keeps the held place until its code arrives
  return shown ? <Suspense fallback={hold}>{children}</Suspense> : hold;
}

const waiting: Array<() => Promise<unknown>> = [];

/** How long after the game is up its deferred code starts to arrive, unless the player touches the screen first. */
export const WARM_AFTER_MS = 6000;

/**
 * Fetches every deferred component's code, one at a time in idle moments, once the game has been up a while or the
 * player first touches it, so a tap later opens its panel at once even on a slow phone. Returns a stop function.
 */
export function warmDeferred(): () => void {
  let stopped = false;
  let started = false;
  const idle = (f: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(() => f(), { timeout: 2000 }) : setTimeout(f, 50));
  const next = () => {
    if (stopped) return;
    const load = waiting.shift();
    if (load) load().then(() => idle(next), () => idle(next));
  };
  const start = () => {
    if (started || stopped) return;
    started = true;
    window.removeEventListener("pointerdown", start);
    idle(next);
  };
  const timer = setTimeout(start, WARM_AFTER_MS);
  window.addEventListener("pointerdown", start, { once: true });
  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("pointerdown", start);
  };
}

/**
 * P3: a component whose code loads the first time it is drawn, so the game's start-up does not carry it. It draws
 * nothing in its place until its code arrives: for arrivals, dialogs and panels that open on a tap. A panel in a long
 * sheet goes in <Lazy> instead, which holds its place.
 */
export function deferred<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => ReactElement {
  waiting.push(load);
  const Inner = lazy(async () => ({ default: await load() }));
  return function Deferred(props: P) {
    return (
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    );
  };
}
