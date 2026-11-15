/**
 * A panel drawn only once it comes near the screen (PRD R5): long sheets open at
 * once on slow phones instead of building every panel, and anything below stays
 * a light placeholder until it is scrolled to.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Lazy({ children, height = 240 }: { children: ReactNode; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), { root: el.closest(".sheet") ?? null, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return shown ? <>{children}</> : <div ref={ref} className="lazy-hold" style={{ minHeight: height }} aria-hidden="true" />;
}
