/** Talking to a character: their lines type out in a bubble, then the player picks a topic. */

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Action, Character, Line } from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import "./talk.css";

const ACTION_LABEL: Record<Action, [string, string]> = {
  shop: ["Open the shop", "打开商店"],
  map: ["Open the map", "打开地图"],
  quests: ["See errands", "看看差事"],
  mind: ["Teach my pet", "去教宠物"],
  spar: ["Go to spars", "去切磋"],
  bag: ["Open my bag", "打开背包"],
  proof: ["See the proof", "查看证明"],
};

export function Talk({ who, onFace, onAction, onClose }: { who: Character; onFace: (face: string) => void; onAction: (a: Action) => void; onClose: () => void }) {
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const [queue, setQueue] = useState<Line[]>(who.greeting);
  const [at, setAt] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [typed, setTyped] = useState(0);
  const [ending, setEnding] = useState(false);
  const line = queue[at] ?? null;
  const text = line ? line[lang] : "";

  useEffect(() => {
    if (line) onFace(line.face);
  }, [line, onFace]);
  useEffect(() => {
    setTyped(reduce ? text.length : 0);
  }, [text, reduce]);
  useEffect(() => {
    if (typed >= text.length) return;
    const id = setTimeout(() => setTyped((n) => Math.min(text.length, n + (lang === "zh" ? 1 : 2))), 24);
    return () => clearTimeout(id);
  }, [typed, text, lang]);

  const done = typed >= text.length;
  const lastLine = at >= queue.length - 1;
  const advance = () => {
    if (!done) return setTyped(text.length);
    play("tap");
    if (!lastLine) return setAt((n) => n + 1);
    if (ending) return onClose();
  };
  const pickTopic = (i: number) => {
    play("tap");
    const t = who.topics[i]!;
    setQueue(t.lines);
    setAt(0);
    setAction(t.action ?? null);
  };
  const sayBye = () => {
    play("tap");
    setQueue([who.bye]);
    setAt(0);
    setAction(null);
    setEnding(true);
  };
  const showChoices = done && lastLine && !ending;

  return (
    <motion.div className="talk" role="dialog" aria-label={who.name[lang]} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
      <button type="button" className="talk-bubble" onClick={advance} aria-live="polite">
        <span className="talk-name" style={{ background: who.color }}>
          {who.name[lang]}
          <small>{who.role[lang]}</small>
        </span>
        <span className="talk-text">
          {text.slice(0, typed)}
          <span className="talk-ghost" aria-hidden="true">
            {text.slice(typed)}
          </span>
        </span>
        {done && (!lastLine || ending) && <span className="talk-more" aria-hidden="true">▼</span>}
      </button>
      {showChoices && (
        <div className="talk-choices">
          {action && (
            <button type="button" className="talk-choice go" onClick={() => (play("tap"), onAction(action))}>
              {ACTION_LABEL[action][lang === "zh" ? 1 : 0]}
            </button>
          )}
          {who.topics.map((t, i) => (
            <button key={i} type="button" className="talk-choice" onClick={() => pickTopic(i)}>
              {t.ask[lang]}
            </button>
          ))}
          <button type="button" className="talk-choice bye" onClick={sayBye}>
            {lang === "zh" ? "再见" : "Goodbye"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
