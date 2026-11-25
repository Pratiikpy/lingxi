/**
 * The ways to teach (P7: out of Teach.tsx): the school's levels, saying it in words, building it by hand, the
 * library of others' lessons, and a mentor.
 */
/**
 * Teaching: lessons learned (reorder or forget), Pet School, plain words (web
 * build), and a rule builder. Every path shows the rule first; nothing changes
 * the pet until the owner confirms, and the game rules check it again then.
 */

import { CuteState } from "../CuteState";
import { useEffect, useMemo, useState } from "react";
import { type Rule } from "@lingxi/brain";
import { PET_SCHOOL, type Pet, childOf, levelOpen, schoolReport, stageOf } from "@lingxi/game";
import { useLang, useT } from "../../i18n";
import { type TeachingState, teachInWords, teachingState } from "../../game/api";
import { teachBody } from "../../game/requests";
import { questSlots } from "../../game/tally";
import { type LibraryLesson, libraryAvailable, listLessons, reportLesson } from "../../game/library";
import { play } from "../../game/sound";
import { mindParts, programFor, useGame } from "../../game/store";
import { Icon } from "../icons";
import { Chips } from "../parts";
import { MOOD_NAMES, VALUE_NAMES, WANT_NAMES, chipsFor } from "../ruleText";
import "../teach.css";
import { now } from "../../game/gameClock";
import { NOT_ON_OFFER, REASON_KEY, useSpec } from "./shared";

/** Pet School as eight levels with three goals each, scored by running the pet's own brain (PRD F8). */
export function SchoolLevels({
  pet,
  canLearn,
  onPropose,
}: {
  pet: Pet;
  canLearn: boolean;
  onPropose: (rule: Rule) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const spec = useSpec(pet);
  const report = useMemo(() => schoolReport(spec), [spec]);
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
                data-hint={open && !lv.learned && canLearn ? "teach" : undefined}
                aria-label={`${t("teach.level", { n: i + 1 })}: ${lesson.say[lang]}`}
              >
                <span className="level-n">{i + 1}</span>
                <span className="level-say">“{lesson.say[lang]}”</span>
                <span className="level-stars" aria-label={t("teach.starsOf", { n: lv.stars })}>
                  {open ? (
                    [0, 1, 2].map((k) => (
                      <i key={k} className={k < lv.stars ? "on" : ""}>
                        ★
                      </i>
                    ))
                  ) : (
                    <Icon name="lock" size={14} />
                  )}
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

export function Words({ pet, onPropose }: { pet: Pet; onPropose: (rule: Rule, reply: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [teaching, setTeaching] = useState<TeachingState | null>(null);
  const available = teaching === null ? null : teaching === "ready";
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    teachingState().then((s) => live && setTeaching(s));
    return () => {
      live = false;
    };
  }, []);
  if (teaching !== null && teaching !== "ready")
    return <CuteState who={{ cat: "nap" }} text={t(NOT_ON_OFFER[teaching])} />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!words.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    play("tap");
    const r = await teachInWords(teachBody(words, pet, stageOf(pet, now()), questSlots()));
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
        <input
          id="teach-words"
          value={words}
          maxLength={240}
          placeholder={t("teach.wordsHint")}
          onChange={(e) => setWords(e.target.value)}
          autoComplete="off"
          disabled={busy || available === null}
        />
        <button type="submit" className="btn primary" disabled={!words.trim() || busy || available === null}>
          {t("teach.ask")}
        </button>
      </div>
      {busy && <p className="small thinking-dots">{t("teach.thinking", { name: pet.name })}</p>}
      {msg && <p className="reply">{msg}</p>}
    </form>
  );
}

export const BUILD_FIELDS = ["hunger", "joy", "energy", "clean", "time", "action", "event", "owner"] as const;

export function Builder({ pet, onPropose }: { pet: Pet; onPropose: (rule: Rule) => void }) {
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
              <button
                key={v}
                type="button"
                className={`val${conds[f]!.includes(v) ? " on" : ""}`}
                aria-pressed={conds[f]!.includes(v)}
                onClick={() => toggle(f, v)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <select
        aria-label={t("teach.addCond")}
        value={adding}
        onChange={(e) => {
          const f = e.target.value;
          setAdding("");
          if (f && !conds[f]) setConds((c) => ({ ...c, [f]: [VALUE_NAMES[f]![lang].length - 1] }));
        }}
      >
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
          <button
            key={w}
            type="button"
            className={`val${want === i ? " on" : ""}`}
            aria-pressed={want === i}
            onClick={() => setWant(i)}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="vals">
        {MOOD_NAMES[lang].map((m, i) => (
          <button
            key={m}
            type="button"
            className={`val${mood === i ? " on" : ""}`}
            aria-pressed={mood === i}
            onClick={() => setMood(i)}
          >
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
export function Library({ pet, onPropose }: { pet: Pet; onPropose: (l: LibraryLesson) => void }) {
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
  const known = (r: Rule) =>
    pet.lessons.some(
      (x) => JSON.stringify(x.when) === JSON.stringify(r.when) && JSON.stringify(x.then) === JSON.stringify(r.then),
    );
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

/**
 * Elders mentor (G4): an elder passes one of its lessons to one of its own children. Shown only to an elder that has a
 * child on this device; the child learns it as any lesson, within its own slots and budget.
 */
export function Mentor({ pet }: { pet: Pet }) {
  const { lang } = useLang();
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const pets = useGame((s) => s.pets);
  const mentor = useGame((s) => s.mentor);
  const [child, setChild] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const children = pets.map((p, i) => ({ p, i })).filter(({ p }) => childOf(pet, p));
  if (stageOf(pet, now()) !== "elder" || !children.length || !pet.lessons.length) return null;
  const picked = children[Math.min(child, children.length - 1)]!;
  const program = programFor(pet.line, pet.lessons, pet.instincts ?? 0, pet.growth);
  return (
    <section className="mentor" aria-label={L("Pass a lesson on", "把一课传下去")}>
      <p className="label">{L("Pass a lesson on", "把一课传下去")}</p>
      <p className="small">
        {L(
          `${pet.name} is an elder now. It can teach one of its lessons to its child, the way it learned them.`,
          `${pet.name}已经是长者了，可以把自己的一课教给它的孩子，就像当初它学会时那样。`,
        )}
      </p>
      {children.length > 1 && (
        <div className="row mentor-kids">
          {children.map(({ p }, k) => (
            <button
              key={p.bornAt}
              type="button"
              className={`btn${k === child ? " primary" : ""}`}
              aria-pressed={k === child}
              onClick={() => (play("tap"), setChild(k), setSaid(null))}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <ul className="mentor-lessons">
        {pet.lessons.map((l, i) => {
          const c = chipsFor(program, l, lang);
          const known = picked.p.lessons.some(
            (x) => JSON.stringify([x.when, x.then]) === JSON.stringify([l.when, l.then]),
          );
          return (
            <li key={i}>
              <Chips when={c.when} then={c.then} want={c.want} />
              <button
                type="button"
                className="btn"
                disabled={known}
                onClick={() => {
                  const r = mentor(picked.i, i);
                  play(r.ok ? "success" : "error");
                  setSaid(
                    r.ok
                      ? L(`${picked.p.name} learned it from ${pet.name}.`, `${picked.p.name}跟着${pet.name}学会了。`)
                      : r.reason === "full"
                        ? L(`${picked.p.name} has no room for another lesson.`, `${picked.p.name}装不下更多课了。`)
                        : r.reason === "tooBig"
                          ? L(
                              `That lesson is too big for ${picked.p.name}'s budget.`,
                              `这一课超出了${picked.p.name}的预算。`,
                            )
                          : L("That lesson cannot be passed on now.", "这一课现在传不了。"),
                  );
                }}
              >
                {known
                  ? L(`${picked.p.name} knows it`, `${picked.p.name}会了`)
                  : L(`Teach ${picked.p.name}`, `教给${picked.p.name}`)}
              </button>
            </li>
          );
        })}
      </ul>
      {said && (
        <p className="small" role="status">
          {said}
        </p>
      )}
    </section>
  );
}
