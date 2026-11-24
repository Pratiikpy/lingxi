/**
 * The result of the start-up rules check (plan 4.11): a short mark when every rule matches its circuit on X Layer,
 * a warning that stays until closed when one does not, and nothing when X Layer could not be read (no claim either way).
 * Either waits while a sheet or a dialog is open over the room, and steps aside when one opens, so it never covers
 * what the player is reading (A3). The mark pops up once for a set of rules, not on every load (B5): after that the
 * proof stays in the circuit view's caption (BrainView), one tap away. A warning shows every time.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLang } from "../i18n";
import { useRulesCheck } from "../game/rulesCheck";
import "./rules-mark.css";

const SHOW_MS = 5000;
/** The set of rules whose mark the player has already seen, by their circuit ids. */
const SEEN_KEY = "lingxi.rulesSeen";
const seenSet = (): string | null => {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
};
const markSeen = (set: string): void => {
  try {
    localStorage.setItem(SEEN_KEY, set);
  } catch {
    // a browser that keeps nothing shows the mark again next time, which is no harm
  }
};
/** A sheet or a dialog over the room: every one in the game marks itself so. The circuit view counts too: its own
 * caption carries the check, and the mark would lie over its input labels (B5). */
const OVERLAY = '[role="dialog"], [aria-modal="true"], .circuit-overlay';

/** A set of rules, as the circuits it was checked against. */
const ruleSet = (checks: readonly { name: string; id: string | null }[]): string =>
  checks.map((c) => `${c.name}:${c.id ?? ""}`).join(",");

/** Whether a sheet or a dialog is open, kept current as they open and close. */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(() => !!document.querySelector(OVERLAY));
  useEffect(() => {
    let frame = 0;
    const look = () => {
      frame = 0;
      setOpen(!!document.querySelector(OVERLAY));
    };
    const watcher = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(look);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    look();
    return () => {
      watcher.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return open;
}

export function RulesMark() {
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const { state, checks, run } = useRulesCheck();
  const covered = useOverlayOpen();
  // the mark is owed once the rules are verified, and shown for SHOW_MS of time with nothing open over the room
  const [owed, setOwed] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    void run();
  }, [run]);
  const [stateSeen, setStateSeen] = useState<typeof state | null>(null);
  if (state !== stateSeen) {
    setStateSeen(state);
    // owed the first time this set of rules is verified on this browser
    if (state === "verified") setOwed(seenSet() !== ruleSet(checks));
  }
  useEffect(() => {
    if (!owed || covered) return;
    const id = setTimeout(() => setOwed(false), SHOW_MS);
    return () => clearTimeout(id);
  }, [owed, covered]);
  const shown = owed && !covered;
  useEffect(() => {
    if (shown && state === "verified") markSeen(ruleSet(checks));
  }, [shown, state, checks]);
  const bad = checks.filter((c) => c.status === "differs" || c.status === "missing");
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const proof = "verify.html#rules";
  const verified = L(
    `Rules verified on X Layer · ${checks.length} circuits`,
    `规则已在 X Layer 上核对 · ${checks.length} 个电路`,
  );
  return (
    <>
      {/* P5: the news is read out from a live region that is always on the page; the mark itself stays a plain link
          (a link given the status role lost its name and its role to screen readers) */}
      <span className="sr-only" role="status">
        {state === "verified" && shown ? verified : ""}
      </span>
      <AnimatePresence>
        {state === "verified" && shown && (
          <motion.a
            key="ok"
            className="rules-mark"
            href={proof}
            target="_blank"
            rel="noopener"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="rules-tick" aria-hidden="true">
              ✓
            </span>
            {verified}
          </motion.a>
        )}
        {state === "broken" && !closed && !covered && (
          <motion.div
            key="bad"
            className="rules-mark is-bad"
            role="alert"
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span className="rules-tick" aria-hidden="true">
              !
            </span>
            <span>
              {L(
                `${bad.length === 1 ? "A rule here differs" : `${bad.length} rules here differ`} from ${bad.length === 1 ? "its circuit" : "their circuits"} on X Layer: ${bad.map((c) => c.name).join(", ")}. `,
                `这里有 ${bad.length} 条规则和 X Layer 上的电路不一致：${bad.map((c) => c.name).join("、")}。`,
              )}
              <a href={proof} target="_blank" rel="noopener">
                {L("See which", "查看详情")}
              </a>
            </span>
            <button
              type="button"
              className="rules-close"
              aria-label={L("Close", "关闭")}
              onClick={() => setClosed(true)}
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
