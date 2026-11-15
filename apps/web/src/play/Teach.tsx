/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Rule } from "@lingxi/brain";
import { LESSON_CAPACITY, PET_SCHOOL, type Pet, checkLesson, stageOf } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { teachInWords, teachingAvailable } from "../game/api";
import { play } from "../game/sound";
import { programFor, useGame } from "../game/store";
import { Icon } from "./icons";
import { Chips } from "./parts";
import { MOOD_NAMES, VALUE_NAMES, WANT_NAMES, chipsFor } from "./ruleText";
import "./teach.css";

const REASON_KEY: Record<string, Key> = {
  full: "teach.full",
  duplicate: "teach.dup",
  tooBig: "teach.tooBig",
  invalid: "teach.invalid",
  busy: "teach.busy",
  offline: "teach.offline",
  error: "teach.error",
};

function RulePreview({ pet, rule }: { pet: Pet; rule: Rule }) {
  const { lang } = useLang();
  const c = chipsFor(programFor(pet.line, pet.lessons), rule, lang);
  return (
    <div className="rule-preview">
      <Chips when={c.when} then={c.then} />
    </div>
  );
}

function Proposal({ pet, rule, reply, onDone }: { pet: Pet; rule: Rule; reply?: string; onDone: () => void }) {
  const t = useT();
  const learn = useGame((s) => s.learn);
  const [err, setErr] = useState<string | null>(null);
  const confirm = () => {
    const r = learn(rule);
    if (r.ok) {
      play("success");
      onDone();
    } else {
      play("error");
      setErr(t(REASON_KEY[r.reason] ?? "teach.error", { name: pet.name }));
    }
  };
  return (
    <motion.div className="proposal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      {reply && <p className="reply">{reply}</p>}
      <p className="small">{t("teach.became")}</p>
      <RulePreview pet={pet} rule={rule} />
      {err && <p className="err" role="alert">{err}</p>}
      <div className="row">
        <button type="button" className="btn primary" onClick={confirm}>
          {t("teach.confirm")}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t("teach.retry")}
        </button>
      </div>
    </motion.div>
  );
}

function Learned({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const arrange = useGame((s) => s.arrange);
  const p = programFor(pet.line, pet.lessons);
  if (!pet.lessons.length) return <p className="small">{t("teach.none")}</p>;
  return (
    <ol className="learned">
      {pet.lessons.map((r, i) => {
        const c = chipsFor(p, r, lang);
        return (
          <li key={`${r.label}-${i}`}>
            <div className="rule-preview">
              <Chips when={c.when} then={c.then} />
            </div>
            <div className="mini">
              <button type="button" aria-label={t("teach.up")} disabled={i === 0} onClick={() => arrange(i, "up")}>
                ▲
              </button>
              <button type="button" aria-label={t("teach.down")} disabled={i === pet.lessons.length - 1} onClick={() => arrange(i, "down")}>
                ▼
              </button>
              <button type="button" aria-label={t("teach.forget")} onClick={() => arrange(i, "forget")}>
                <Icon name="close" size={12} />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Words({ pet, onPropose }: { pet: Pet; onPropose: (rule: Rule, reply: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    teachingAvailable().then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
    };
  }, []);
  if (available === false) return <p className="small">{t("teach.offline")}</p>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!words.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    play("tap");
    const r = await teachInWords({ words, name: pet.name, line: pet.line, stage: stageOf(pet, Date.now()), lessons: pet.lessons });
    setBusy(false);
    if (r.ok) onPropose(r.rule, r.reply[lang]);
    else setMsg(r.reply?.[lang] ?? t(REASON_KEY[r.reason] ?? "teach.error", { name: pet.name }));
  };
  return (
    <form className="words" onSubmit={submit}>
      <label htmlFor="teach-words" className="sr">
        {t("teach.words")}
      </label>
      <div className="words-row">
        <input id="teach-words" value={words} maxLength={240} placeholder={t("teach.wordsHint")} onChange={(e) => setWords(e.target.value)} autoComplete="off" disabled={busy || available === null} />
        <button type="submit" className="btn primary" disabled={!words.trim() || busy || available === null}>
          {t("teach.ask")}
        </button>
      </div>
      {busy && <p className="small thinking-dots">{t("teach.thinking", { name: pet.name })}</p>}
      {msg && <p className="reply">{msg}</p>}
    </form>
  );
}

const BUILD_FIELDS = ["hunger", "joy", "energy", "clean", "time", "action", "event", "owner"] as const;

function Builder({ pet, onPropose }: { pet: Pet; onPropose: (rule: Rule) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [conds, setConds] = useState<Record<string, number[]>>({ event: [2] });
  const [want, setWant] = useState(2);
  const [mood, setMood] = useState(3);
  const toggle = (f: string, v: number) =>
    setConds((c) => {
      const cur = c[f] ?? [];
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort((a, b) => a - b);
      const out = { ...c };
      if (next.length) out[f] = next;
      else delete out[f];
      return out;
    });
  const [adding, setAdding] = useState<string>("");
  const rule: Rule = { when: conds, then: { want, mood }, label: "my rule" };
  const valid = Object.keys(conds).length > 0;
  return (
    <div className="builder">
      <p className="label">{t("teach.when")}</p>
      {Object.keys(conds).map((f) => (
        <div key={f} className="cond">
          <div className="vals" role="group" aria-label={f}>
            {VALUE_NAMES[f]![lang].map((name, v) => (
              <button key={v} type="button" className={`val${conds[f]!.includes(v) ? " on" : ""}`} aria-pressed={conds[f]!.includes(v)} onClick={() => toggle(f, v)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <select aria-label={t("teach.addCond")} value={adding} onChange={(e) => {
        const f = e.target.value;
        setAdding("");
        if (f && !conds[f]) setConds((c) => ({ ...c, [f]: [VALUE_NAMES[f]![lang].length - 1] }));
      }}>
        <option value="">+ {t("teach.addCond")}</option>
        {BUILD_FIELDS.filter((f) => !conds[f]).map((f) => (
          <option key={f} value={f}>
            {VALUE_NAMES[f]![lang].join(" / ")}
          </option>
        ))}
      </select>
      <p className="label">{t("teach.then", { name: pet.name })}</p>
      <div className="vals">
        {WANT_NAMES[lang].map((w, i) => (
          <button key={w} type="button" className={`val${want === i ? " on" : ""}`} aria-pressed={want === i} onClick={() => setWant(i)}>
            {w}
          </button>
        ))}
      </div>
      <div className="vals">
        {MOOD_NAMES[lang].map((m, i) => (
          <button key={m} type="button" className={`val${mood === i ? " on" : ""}`} aria-pressed={mood === i} onClick={() => setMood(i)}>
            {m}
          </button>
        ))}
      </div>
      <button type="button" className="btn primary" disabled={!valid} onClick={() => onPropose(rule)}>
        {t("teach.preview")}
      </button>
    </div>
  );
}

export function TeachPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const [proposal, setProposal] = useState<{ rule: Rule; reply?: string } | null>(null);
  const stage = stageOf(pet, Date.now());
  const max = LESSON_CAPACITY[stage];
  const full = pet.lessons.length >= max;
  const propose = (rule: Rule, reply?: string) => {
    const check = checkLesson(pet.line, stage, pet.lessons, rule);
    setProposal({ rule: check.ok ? check.program.rules[0]! : rule, ...(reply ? { reply } : {}) });
  };
  return (
    <div className="teach">
      <div className="teach-head">
        <p className="label">{t("teach.learned", { name: pet.name })}</p>
        <span className="cap">{t("teach.capacity", { n: pet.lessons.length, max })}</span>
      </div>
      <Learned pet={pet} />
      <AnimatePresence mode="wait">
        {proposal ? (
          <Proposal key="p" pet={pet} rule={proposal.rule} {...(proposal.reply ? { reply: proposal.reply } : {})} onDone={() => setProposal(null)} />
        ) : full ? (
          <p key="f" className="small">{t("teach.full", { name: pet.name })}</p>
        ) : (
          <motion.div key="choose" className="teach-choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p className="label">{t("teach.school")}</p>
            <div className="school">
              {PET_SCHOOL.filter((l) => !pet.lessons.some((x) => x.label === l.rule.label)).map((l) => (
                <button key={l.id} type="button" className="say" onClick={() => (play("tap"), propose(l.rule))}>
                  “{l.say[lang]}”
                </button>
              ))}
            </div>
            <p className="label">{t("teach.words")}</p>
            <Words pet={pet} onPropose={propose} />
            <details className="build">
              <summary>{t("teach.build")}</summary>
              <Builder pet={pet} onPropose={(r) => propose(r)} />
            </details>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
