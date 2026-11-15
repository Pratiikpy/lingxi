/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { CuteState } from "./CuteState";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Rule } from "@lingxi/brain";
import { LESSON_CAPACITY, PET_SCHOOL, type Pet, type Trap, brainSize, checkLesson, lessonCost, levelOpen, schoolReport, stageOf, trapsAfter } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { teachInWords, teachingAvailable } from "../game/api";
import { type LibraryLesson, libraryAvailable, listLessons, reportLesson, shareLesson, usedLesson } from "../game/library";
import { play } from "../game/sound";
import { mindParts, useGame } from "../game/store";
import { Icon } from "./icons";
import { Chips } from "./parts";
import { Sandbox } from "./Sandbox";
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
  const c = chipsFor(mindParts(pet)[0]!.program, rule, lang);
  return (
    <div className="rule-preview">
      <Chips when={c.when} then={c.then} want={c.want} />
    </div>
  );
}

/** Where a proposed lesson came from: Pet School, the library (by key), or the owner's own words or blocks. */
type Source = { kind: "school" } | { kind: "library"; key: string } | { kind: "own" };

function Proposal({ pet, rule, reply, source, onDone }: { pet: Pet; rule: Rule; reply?: string; source: Source; onDone: () => void }) {
  const t = useT();
  const learn = useGame((s) => s.learn);
  const [err, setErr] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const onTopTraps = trapsAfter(specOf(pet), [rule, ...pet.lessons]);
  const belowIsClean = onTopTraps.length > 0 && pet.lessons.length > 0 && trapsAfter(specOf(pet), [...pet.lessons, rule]).length === 0;
  const confirm = (at: "top" | "bottom" = "top") => {
    const r = learn(rule, at);
    if (r.ok) {
      play("success");
      if (source.kind === "library") void usedLesson(source.key);
      if (source.kind === "own" && share) void shareLesson(rule, pet.name);
      onDone();
    } else {
      play("error");
      setErr(t(REASON_KEY[r.reason] ?? "teach.error", { name: pet.name }));
    }
  };
  return (
    <motion.div className="proposal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      {reply && <p className="reply">{reply}</p>}
      <p className="small">{t(source.kind === "school" ? "teach.becameSchool" : source.kind === "library" ? "teach.becameLibrary" : "teach.became")}</p>
      <RulePreview pet={pet} rule={rule} />
      <CostLine pet={pet} rule={rule} />
      <TrapNote pet={pet} traps={onTopTraps} />
      {err && <p className="err" role="alert">{err}</p>}
      {source.kind === "own" && libraryAvailable() && (
        <label className="share-opt">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          {t("library.shareOpt", { name: pet.name })}
        </label>
      )}
      <div className="row">
        {belowIsClean && (
          <button type="button" className="btn primary" onClick={() => confirm("bottom")}>
            {t("teach.confirmBelow")}
          </button>
        )}
        <button type="button" className={`btn${belowIsClean ? "" : " primary"}`} onClick={() => confirm()}>
          {t("teach.confirm")}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {t("teach.retry")}
        </button>
      </div>
    </motion.div>
  );
}

const specOf = (pet: Pet) => ({ line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts });

/** What a lesson costs in gates, and what sharing logic saves (PRD F6). */
function CostLine({ pet, rule }: { pet: Pet; rule: Rule }) {
  const t = useT();
  const c = useMemo(() => {
    try {
      return lessonCost(specOf(pet), rule);
    } catch {
      return null;
    }
  }, [pet.lessons, pet.family, pet.instincts, pet.line, rule]);
  if (!c) return null;
  return (
    <p className={`cost${c.fits ? "" : " over"}`}>
      {t("teach.cost", { adds: c.adds, total: c.total })}
      {c.saved > 0 && <b> {t("teach.saved", { n: c.saved })}</b>}
    </p>
  );
}

/** The brain's size against its budget. */
function GateMeter({ pet }: { pet: Pet }) {
  const t = useT();
  const size = useMemo(() => brainSize(specOf(pet)), [pet.lessons, pet.family, pet.instincts, pet.line]);
  return (
    <div className="gates" title={t("teach.gatesWhy")}>
      <span>{t("teach.gates", { n: size.gates, max: size.max })}</span>
      <i role="meter" aria-valuemin={0} aria-valuemax={size.max} aria-valuenow={size.gates} aria-label={t("teach.gates", { n: size.gates, max: size.max })}>
        <i style={{ transform: `scaleX(${Math.min(1, size.gates / size.max)})` }} />
      </i>
    </div>
  );
}

/** A lesson order that takes stars from another lesson, said plainly with the rule that gets in the way (PRD F7). */
function TrapNote({ pet, traps }: { pet: Pet; traps: Trap[] }) {
  const t = useT();
  const { lang } = useLang();
  if (!traps.length) return null;
  const p = mindParts(pet)[0]!.program;
  return (
    <div className="trap" role="alert">
      <p>{t("teach.trap", { n: traps.length })}</p>
      <ul>
        {traps.slice(0, 3).map((tr, i) => {
          const c = chipsFor(p, tr.blocker, lang);
          const school = PET_SCHOOL.find((l) => l.id === tr.victim)!;
          return (
            <li key={i}>
              <span className="rule-preview">
                <Chips when={c.when} then={c.then} want={c.want} />
              </span>
              <span>{t("teach.trapWhy", { goal: tr.goal.say[lang], lesson: school.say[lang] })}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pet School as eight levels with three goals each, scored by running the pet's own brain (PRD F8). */
function SchoolLevels({ pet, canLearn, onPropose }: { pet: Pet; canLearn: boolean; onPropose: (rule: Rule) => void }) {
  const t = useT();
  const { lang } = useLang();
  const report = useMemo(() => schoolReport(specOf(pet)), [pet.lessons, pet.family, pet.instincts, pet.line]);
  const total = report.reduce((n, r) => n + r.stars, 0);
  return (
    <section className="levels" aria-label={t("teach.school")}>
      <div className="teach-head">
        <p className="label">{t("teach.school")}</p>
        <span className="cap">{t("teach.stars", { n: total, max: report.length * 3 })}</span>
      </div>
      {!pet.lessons.length && <p className="coach-tip">{t("teach.coach1", { name: pet.name })}</p>}
      <ol>
        {report.map((lv, i) => {
          const lesson = PET_SCHOOL[i]!;
          const open = levelOpen(report, i);
          return (
            <li key={lv.id} className={`level${lv.learned ? " done" : ""}${open ? "" : " level-shut"}`}>
              <button
                type="button"
                className="level-head"
                disabled={lv.learned || !open || !canLearn}
                onClick={() => (play("tap"), onPropose(lesson.rule))}
                aria-label={`${t("teach.level", { n: i + 1 })}: ${lesson.say[lang]}`}
              >
                <span className="level-n">{i + 1}</span>
                <span className="level-say">“{lesson.say[lang]}”</span>
                <span className="level-stars" aria-label={t("teach.starsOf", { n: lv.stars })}>
                  {open ? [0, 1, 2].map((k) => <i key={k} className={k < lv.stars ? "on" : ""}>★</i>) : <Icon name="lock" size={14} />}
                </span>
              </button>
              {lv.learned && (
                <ul className="goals">
                  {lv.goals.map((g, k) => (
                    <li key={k} className={g.met ? "met" : "missed"}>
                      <b aria-hidden="true">{g.met ? "✓" : "✗"}</b> {g.goal.say[lang]}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Learned({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const doArrange = useGame((s) => s.arrange);
  const [pending, setPending] = useState<{ index: number; move: "up" | "down"; traps: Trap[] } | null>(null);
  const arrange = (index: number, move: "up" | "down" | "forget") => {
    if (move === "forget") return doArrange(index, move);
    const next = pet.lessons.slice();
    const j = move === "up" ? index - 1 : index + 1;
    [next[index], next[j]] = [next[j]!, next[index]!];
    const traps = trapsAfter(specOf(pet), next);
    if (traps.length) {
      play("error");
      setPending({ index, move, traps });
      return;
    }
    setPending(null);
    doArrange(index, move);
  };
  const p = mindParts(pet)[0]!.program;
  if (!pet.lessons.length) return <CuteState who={{ pet, expression: "shy" }} text={t("teach.none")} />;
  return (
    <>
    {pending && (
      <div className="trap-confirm">
        <TrapNote pet={pet} traps={pending.traps} />
        <div className="row">
          <button type="button" className="btn" onClick={() => setPending(null)}>
            {t("teach.keepOrder")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              doArrange(pending.index, pending.move);
              setPending(null);
            }}
          >
            {t("teach.moveAnyway")}
          </button>
        </div>
      </div>
    )}
    <ol className="learned">
      {pet.lessons.map((r, i) => {
        const c = chipsFor(p, r, lang);
        return (
          <li key={`${r.label}-${i}`}>
            <div className="rule-preview">
              <Chips when={c.when} then={c.then} want={c.want} />
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
    </>
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
  if (available === false) return <CuteState who={{ cat: "nap" }} text={t("teach.offline")} />;
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

/** Lessons other players shared, most learned first; ones this pet already knows are left out. */
function Library({ pet, onPropose }: { pet: Pet; onPropose: (l: LibraryLesson) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [lessons, setLessons] = useState<LibraryLesson[] | null>(null);
  const [reported, setReported] = useState<string[]>([]);
  useEffect(() => {
    if (!libraryAvailable()) return;
    let live = true;
    void listLessons().then((l) => live && setLessons(l));
    return () => {
      live = false;
    };
  }, []);
  if (!libraryAvailable()) return null;
  const program = mindParts(pet)[0]!.program;
  const known = (r: Rule) => pet.lessons.some((x) => JSON.stringify(x.when) === JSON.stringify(r.when) && JSON.stringify(x.then) === JSON.stringify(r.then));
  const shown = (lessons ?? []).filter((l) => !known(l.rule) && !reported.includes(l.key)).slice(0, 8);
  return (
    <div className="library">
      <p className="label">{t("library.title")}</p>
      {lessons === null ? (
        <CuteState who={{ cat: "look" }} text={t("library.loading")} busy />
      ) : shown.length === 0 ? (
        <CuteState who={{ cat: "nap" }} text={t("library.empty")} />
      ) : (
        <ul className="lib-list">
          {shown.map((l) => {
            const c = chipsFor(program, l.rule, lang);
            return (
              <li key={l.key}>
                <button type="button" className="lib-rule" onClick={() => (play("tap"), onPropose(l))}>
                  <span className="lib-chips">
                    <Chips when={c.when} then={c.then} want={c.want} />
                  </span>
                  <span className="lib-meta">{t("library.meta", { n: l.uses, by: l.by })}</span>
                </button>
                <button
                  type="button"
                  className="lib-report"
                  aria-label={t("library.report")}
                  title={t("library.report")}
                  onClick={() => {
                    void reportLesson(l.key);
                    setReported((r) => [...r, l.key]);
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function TeachPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const [proposal, setProposal] = useState<{ rule: Rule; reply?: string; source: Source } | null>(null);
  const stage = stageOf(pet, Date.now());
  const max = LESSON_CAPACITY[stage];
  const full = pet.lessons.length >= max;
  const propose = (rule: Rule, reply?: string, source: Source = { kind: "own" }) => {
    const check = checkLesson(pet.line, stage, pet.lessons, rule, pet.instincts);
    setProposal({ rule: check.ok ? check.program.rules[0]! : rule, source, ...(reply ? { reply } : {}) });
  };
  if (pet.sitting || pet.away)
    return (
      <div className="teach">
        <CuteState who={{ pet, expression: "shy" }} text={lang === "zh" ? `${pet.name}是朋友托你照看的，只有它的主人能教它。` : `${pet.name} is a friend's pet staying with you; only its owner teaches it.`} />
        <Sandbox pet={pet} />
      </div>
    );
  return (
    <div className="teach">
      <div className="teach-head">
        <p className="label">{t("teach.learned", { name: pet.name })}</p>
        <span className="cap">{t("teach.capacity", { n: pet.lessons.length, max })}</span>
      </div>
      <GateMeter pet={pet} />
      <Learned pet={pet} />
      <SchoolLevels pet={pet} canLearn={!full && !proposal} onPropose={(rule) => propose(rule, undefined, { kind: "school" })} />
      <Sandbox pet={pet} trying={proposal?.rule ?? null} />
      <AnimatePresence mode="wait">
        {proposal ? (
          <Proposal key="p" pet={pet} rule={proposal.rule} source={proposal.source} {...(proposal.reply ? { reply: proposal.reply } : {})} onDone={() => setProposal(null)} />
        ) : full ? (
          <p key="f" className="small">{t("teach.full", { name: pet.name })}</p>
        ) : (
          <motion.div key="choose" className="teach-choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Library pet={pet} onPropose={(l) => propose(l.rule, undefined, { kind: "library", key: l.key })} />
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
