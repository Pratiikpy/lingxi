/**
 * A panel drawn only once it comes near the screen (PRD R5): long sheets open at
 * once on slow phones instead of building every panel, and anything below stays
 * a light placeholder until it is scrolled to.
 */

import {
  Component,
  type ComponentType,
  type ReactElement,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { warmLater } from "../game/warm";
import { useLang } from "../i18n";
import { CuteState } from "./CuteState";

export function Lazy({ children, height = 240 }: { children: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // a browser that cannot tell when it is near draws it at once
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), {
      root: el.closest(".sheet") ?? null,
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  const hold = <div ref={ref} className="lazy-hold" style={{ minHeight: height }} aria-hidden="true" />;
  // P3: a panel whose code is itself loaded lazily keeps the held place until its code arrives
  return shown ? <Suspense fallback={hold}>{children}</Suspense> : hold;
}

// the warm-up of code loaded on first use lives in game/warm.ts, shared with the X Layer client (chainClient.ts)
export { WARM_AFTER_MS, warmDeferred } from "../game/warm";

/**
 * P3: a component whose code loads the first time it is drawn, so the game's start-up does not carry it. It draws
 * nothing in its place until its code arrives: for arrivals, dialogs and panels that open on a tap. A panel in a long
 * sheet goes in <Lazy> instead, which holds its place.
 */
export function deferred<P extends object>(load: () => Promise<ComponentType<P>>): (props: P) => ReactElement {
  warmLater(load);
  const Inner = lazy(async () => ({ default: await load() }));
  return function Deferred(props: P) {
    return (
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    );
  };
}

/** A panel's code that could not be fetched (as against a panel that failed while drawing, which is not this). */
class PanelLoadError extends Error {
  constructor(cause: unknown) {
    super("a panel's code could not be loaded", { cause });
    this.name = "PanelLoadError";
  }
}

/** Its code, as React.lazy wants it, with a failed fetch named as one. */
const lazyPanel = <P extends object>(load: () => Promise<ComponentType<P>>) =>
  lazy(async () => {
    try {
      return { default: await load() };
    } catch (e) {
      throw new PanelLoadError(e);
    }
  });

/** While a panel's code is on the way: the resident cat looks up, and the sheet says the panel is coming. */
function PanelWait() {
  const zh = useLang((s) => s.lang) === "zh";
  return (
    <div className="panel-wait">
      <CuteState who={{ cat: "look" }} busy text={zh ? "马上就好，正在准备" : "One moment, getting it ready"} />
    </div>
  );
}

/** A panel whose code could not be fetched: said plainly, with a way to fetch it again. */
function PanelFailed({ onRetry }: { onRetry: () => void }) {
  const zh = useLang((s) => s.lang) === "zh";
  return (
    <div className="panel-failed" role="alert">
      <CuteState
        who={{ cat: "sit1" }}
        text={
          zh
            ? "这一部分没有加载出来，可能是网络断了。你的宠物和存档都好好的。"
            : "This part didn't load, most likely the connection dropped. Your pet and your save are fine."
        }
      />
      <button type="button" className="btn" onClick={onRetry}>
        {zh ? "再试一次" : "Try again"}
      </button>
    </div>
  );
}

/** Catches only a panel's failed fetch; anything else goes on to the game's own guard (CrashGuard). */
class PanelGuard extends Component<{ children: ReactNode; onRetry: () => void }, { failed: unknown }> {
  override state = { failed: null as unknown };

  static getDerivedStateFromError(failed: unknown): { failed: unknown } {
    return { failed };
  }

  override render(): ReactNode {
    const { failed } = this.state;
    if (failed === null) return this.props.children;
    if (!(failed instanceof PanelLoadError)) throw failed;
    return <PanelFailed onRetry={this.props.onRetry} />;
  }
}

/**
 * R33: a panel of a sheet whose code loads the first time it is drawn, as deferred() above, but it says what is
 * happening: while its code is on the way the sheet shows it is getting the panel ready (shown only after a moment, so
 * code already warmed never flashes it), and if the code cannot be fetched, a plain message with a Try again that fetches
 * it afresh, in place of the panel alone rather than the whole game. (A build left behind by a deploy is still reloaded
 * once, by boot/staleBuild.ts.)
 */
export function deferredPanel<P extends object>(
  load: () => Promise<ComponentType<P>>,
  { warm = true }: { warm?: boolean } = {},
): (props: P) => ReactElement {
  // R35: `warm: false` for a panel deep in a sheet that most visits never open (the Pet sheet's): its code still arrives
  // only when it is drawn, as it did before it had a loading state and a Try again
  if (warm) warmLater(load);
  const first = lazyPanel(load);
  return function DeferredPanel(props: P) {
    // each try is a fresh fetch: React keeps a lazy component's failure, so a retry needs a new one
    const [attempt, setAttempt] = useState(0);
    const Inner = useMemo(() => (attempt === 0 ? first : lazyPanel(load)), [attempt]);
    return (
      <PanelGuard key={attempt} onRetry={() => setAttempt((n) => n + 1)}>
        <Suspense fallback={<PanelWait />}>
          <Inner {...props} />
        </Suspense>
      </PanelGuard>
    );
  };
}
