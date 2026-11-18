/**
 * The result of the start-up rules check (plan 4.11): a short mark when every rule matches its circuit on X Layer,
 * a warning that stays until closed when one does not, and nothing when X Layer could not be read (no claim either way).
 * Either waits while a sheet or a dialog is open over the room, and steps aside when one opens, so it never covers
 * what the player is reading (A3).
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLang } from "../i18n";
import { useRulesCheck } from "../game/rulesCheck";
import "./rules-mark.css";

const SHOW_MS = 5000;
/** A sheet or a dialog over the room: every one in the game marks itself so. */
const OVERLAY = '[role="dialog"], [aria-modal="true"]';

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
  useEffect(() => {
    if (state === "verified") setOwed(true);
  }, [state]);
  useEffect(() => {
    if (!owed || covered) return;
    const id = setTimeout(() => setOwed(false), SHOW_MS);
    return () => clearTimeout(id);
  }, [owed, covered]);
  const shown = owed && !covered;
  const bad = checks.filter((c) => c.status === "differs" || c.status === "missing");
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const proof = "verify.html#rules";
  return (
    <AnimatePresence>
      {state === "verified" && shown && (
        <motion.a
          key="ok"
          className="rules-mark"
          href={proof}
          target="_blank"
          rel="noopener"
          role="status"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        >
          <span className="rules-tick" aria-hidden="true">
            ✓
          </span>
          {L(`Rules verified on X Layer · ${checks.length} circuits`, `规则已在 X Layer 上核对 · ${checks.length} 个电路`)}
        </motion.a>
      )}
      {state === "broken" && !closed && !covered && (
        <motion.div key="bad" className="rules-mark is-bad" role="alert" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
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
          <button type="button" className="rules-close" aria-label={L("Close", "关闭")} onClick={() => setClosed(true)}>
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
