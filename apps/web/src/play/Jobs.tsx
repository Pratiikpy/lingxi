/**
 * School and jobs (PRD M8): what a pet does with its days. Little ones play,
 * children and teens go to Pet School, grown pets take shifts at a job: a short
 * mini-game paid in in-game coins, more for a pet whose mind suits the work.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { drawPet } from "@lingxi/art";
import { ITEM } from "@lingxi/world";
import { JOBS, type Job, type Pet, SHIFTS_PER_DAY, SHIFT_SECONDS, VISITORS, type WorkLog, PATIENCE_SECONDS, canWork, fitBonus, jobFit, lifeOf, logShift, shiftPay, shiftRounds, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { mindParts, useGame } from "../game/store";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/palette";
import { VisitorArt } from "./Album";
import { Icon } from "./icons";
import { WANT_NAMES } from "./ruleText";
import { Sprite } from "./Sprite";
import { saveWrite } from "../game/saveRuntime";
import { now } from "../game/gameClock";
import { dayAtLeast } from "../game/days";

type Lang = "en" | "zh";
const KEY = "lingxi.work.v1";
const dayKey = () => new Date(now()).toDateString();
/** The day a shift counts against: never earlier than the last day worked, so a clock turned back pays no extra shifts. */
const jobDay = (log: { day: string } | null | undefined) => dayAtLeast(dayKey(), log?.day);
const DISHES = [11110, 11120, 11130, 7202] as const;
const HOUSES = [
  { color: "#ff8a6b", en: "red", zh: "红" },
  { color: "#7fb7f0", en: "blue", zh: "蓝" },
  { color: "#9bdda6", en: "green", zh: "绿" },
] as const;

function loadLogs(): Record<string, WorkLog> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, WorkLog>;
  } catch {
    return {};
  }
}
function saveLog(pet: Pet, log: WorkLog) {
  try {
    saveWrite(KEY, JSON.stringify({ ...loadLogs(), [String(pet.bornAt)]: log }));
  } catch {
    // private mode: lasts for this visit
  }
}

/** The life-stage card at the top of the games: school or work, or still too little. */
export function LifePanel({ pet, onSchool, blocked }: { pet: Pet; onSchool: () => void; blocked: string | null }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const life = lifeOf(stageOf(pet, now()));
  const [log, setLog] = useState<WorkLog | undefined>(() => loadLogs()[String(pet.bornAt)]);
  const [shift, setShift] = useState<Job | null>(null);
  const [done, setDone] = useState<{ job: Job; right: number; wrong: number; pay: number } | null>(null);
  const program = useMemo(() => mindParts(pet)[0]!.program, [pet]);

  if (life === "egg" || life === "baby")
    return (
      <section className="life-card">
        <p className="label">{L("Growing up", "长大中")}</p>
        {/* B7: Pet School is open from day 1 (it is the Mind tab's school); only jobs wait until the pet is grown */}
        <p className="small">
          {L(
            `${pet.name} is still little: play together now. Pet School is open already, and once grown it can take a job.`,
            `${pet.name}还小，现在就一起玩吧。宠物学校现在就能去，长大后还能去打工。`,
          )}
        </p>
        <button type="button" className="btn" onClick={() => (play("tap"), onSchool())}>
          <Icon name="star" size={16} /> {L("Go to Pet School", "去宠物学校")}
        </button>
      </section>
    );

  if (life === "school")
    return (
      <section className="life-card">
        <p className="label">{L("School days", "上学的日子")}</p>
        <p className="small">
          {L(
            `${pet.name} is old enough for Pet School. Each level it passes is something it has really learned: the lesson goes into its brain. Once grown, what it learned decides which jobs suit it.`,
            `${pet.name}到了上宠物学校的年纪。每过一关，都是它真正学会的东西：这一课会写进它的大脑。长大后，学过的东西决定它适合做什么工作。`,
          )}
        </p>
        <button type="button" className="btn primary" onClick={() => (play("tap"), onSchool())}>
          <Icon name="star" size={16} /> {L("Go to Pet School", "去宠物学校")}
        </button>
      </section>
    );

  if (shift)
    return (
      <Shift
        pet={pet}
        job={shift}
        onEnd={(right, wrong) => {
          const fit = jobFit(program, shift);
          const pay = shiftPay(right, wrong, fit);
          const next = logShift(log, jobDay(log), pay);
          saveLog(pet, next);
          setLog(next);
          useWorld.getState().reward(pay);
          useGame.getState().act({ kind: "play", stars: right >= 12 ? 3 : right >= 6 ? 2 : 1 });
          play(pay > 0 ? "success" : "pop");
          setDone({ job: shift, right, wrong, pay });
          setShift(null);
        }}
      />
    );

  const shiftsLeft = log && log.day === jobDay(log) ? SHIFTS_PER_DAY - log.shifts : SHIFTS_PER_DAY;
  return (
    <section className="life-card">
      <p className="label">{L("Work", "打工")}</p>
      <p className="small">
        {L(
          `${pet.name} is grown and can take a shift: ${shiftsLeft} of ${SHIFTS_PER_DAY} left today. Each right answer pays a coin, each wrong or missed one takes one back. Coins are for the shops, never crypto. A pet whose mind suits the job earns up to half again as much.`,
          `${pet.name}长大了，可以去打工：今天还能上 ${shiftsLeft} / ${SHIFTS_PER_DAY} 班。每做对一次得 1 金币，做错或错过一次扣 1 个。金币是商店用的，不是加密货币。心智适合这份工作的宠物，最多能多赚一半。`,
        )}
        {log?.earned ? L(` Earned at work so far: ${log.earned} coins.`, ` 打工累计赚了 ${log.earned} 金币。`) : ""}
      </p>
      {done && (
        <p className="life-done" role="status">
          {L(`${done.job.name.en}: ${done.right} right, ${done.wrong} missed or wrong, ${done.pay} coins.`, `${done.job.name.zh}：做对 ${done.right} 次，错过或做错 ${done.wrong} 次，赚了 ${done.pay} 金币。`)}
        </p>
      )}
      {blocked && <p className="small warn">{blocked}</p>}
      <ul className="job-list">
        {JOBS.map((j) => {
          const fit = jobFit(program, j);
          return (
            <li key={j.id}>
              <button type="button" className="job-card" disabled={!!blocked || !canWork(log, jobDay(log))} onClick={() => (play("tap"), setDone(null), setShift(j))}>
                <b>{j.name[lang]}</b>
                <small>{j.how[lang]}</small>
                <small>{L(`Suits a pet that wants to ${j.suits.map((w) => WANT_NAMES.en[w]).join(" or ")} at work: teach it that, and it earns more.`, `适合在工作中想要${j.suits.map((w) => WANT_NAMES.zh[w]).join("或")}的宠物：教会它，就能多赚。`)}</small>
                <span className="job-fit">
                  <span className="job-fit-bar" aria-hidden="true">
                    <i style={{ width: `${fit * 100}%` }} />
                  </span>
                  {L(`Suits ${pet.name}: ${Math.round(fit * 100)}% · pay ×${fitBonus(fit)}`, `适合${pet.name}：${Math.round(fit * 100)}% · 工钱 ×${fitBonus(fit)}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!canWork(log, jobDay(log)) && <p className="small">{L(`That's all the shifts for today. ${pet.name} can work again tomorrow.`, `今天的班都上完了，${pet.name}明天还能再来。`)}</p>}
    </section>
  );
}

/** One shift: answer as many rounds right as you can before the time runs out. */
function Shift({ pet, job, onEnd }: { pet: Pet; job: Job; onEnd: (right: number, wrong: number) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const answers = useMemo(() => shiftRounds(job, (now() ^ pet.bornAt) >>> 0, 80), [job, pet.bornAt]);
  const [round, setRound] = useState(0);
  const [right, setRight] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [wait, setWait] = useState(PATIENCE_SECONDS);
  const [left, setLeft] = useState(SHIFT_SECONDS);
  const [flash, setFlash] = useState<"ok" | "no" | null>(null);
  const ended = useRef(false);
  const art = useMemo(() => drawPet(pet.line, "adult", { expression: "happy", ...(pet.form ? { form: pet.form } : {}) }), [pet.line, pet.form]);
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0 && !ended.current) {
      ended.current = true;
      onEnd(right, wrong);
    }
  }, [left, right, wrong, onEnd]);
  // each guest waits a few seconds, then leaves unserved
  const [waitingFor, setWaitingFor] = useState(round);
  if (round !== waitingFor) {
    setWaitingFor(round);
    setWait(PATIENCE_SECONDS);
  }
  useEffect(() => {
    const id = setInterval(() => setWait((w) => w - 1), 1000);
    return () => clearInterval(id);
  }, [round]);
  useEffect(() => {
    if (wait > 0 || ended.current) return;
    play("error");
    setWrong((x) => x + 1);
    setFlash("no");
    setTimeout(() => setFlash(null), 250);
    setRound((r) => r + 1);
  }, [wait]);
  const answer = answers[round % answers.length]!;
  const pick = (i: number) => {
    if (ended.current) return;
    const ok = i === answer;
    play(ok ? "pop" : "error");
    if (ok) setRight((r) => r + 1);
    else setWrong((x) => x + 1);
    setFlash(ok ? "ok" : "no");
    setTimeout(() => setFlash(null), 250);
    setRound((r) => r + 1);
  };
  // the stranger at the gate: a common visitor drawn in shadow
  const guest = VISITORS[(answer + round) % 6]!;

  return (
    <section className={`shift shift-${job.id}${flash ? ` is-${flash}` : ""}`} aria-label={job.name[lang]}>
      <div className="shift-top">
        <b>{job.name[lang]}</b>
        <span>{L(`${right} right · ${wrong} missed`, `做对 ${right} · 错过 ${wrong}`)}</span>
        <span className="shift-time" aria-live="off">
          {left}s
        </span>
      </div>
      <span className="shift-wait" aria-hidden="true">
        <i style={{ width: `${(Math.max(0, wait) / PATIENCE_SECONDS) * 100}%` }} />
      </span>
      <div className="shift-stage">
        <span className="shift-pet">
          <Sprite canvas={art} palette={PALETTE_OF[pet.line]} scale={2} />
        </span>
        {job.id === "cafe" && (
          <div className="shift-ask">
            <span className="small">{L("This guest would like:", "这位客人想要：")}</span>
            <img className="pixel" src={ITEM[DISHES[answer]!]!.art} alt={ITEM[DISHES[answer]!]!.name[lang]} width={48} height={48} />
          </div>
        )}
        {job.id === "courier" && (
          <div className="shift-ask">
            <span className="small">{L("Deliver this parcel to the", "把包裹送到")}</span>
            <span className="shift-parcel" style={{ background: HOUSES[answer]!.color }} aria-label={L(`${HOUSES[answer]!.en} parcel`, `${HOUSES[answer]!.zh}色包裹`)}>
              <Icon name="gift" size={28} />
            </span>
          </div>
        )}
        {job.id === "watch" && (
          <div className="shift-ask">
            <span className="small">{L("Someone at the gate:", "门口有人：")}</span>
            <VisitorArt v={guest} scale={2} hidden={answer === 1} />
            <span className="small">{answer === 1 ? L("a stranger in the dark", "黑暗中的陌生身影") : guest.name[lang]}</span>
          </div>
        )}
      </div>
      <div className={`shift-choices choices-${job.choices}`}>
        {job.id === "cafe" &&
          DISHES.map((d, i) => (
            <button key={d} type="button" className="shift-choice" onClick={() => pick(i)}>
              <img className="pixel" src={ITEM[d]!.art} alt="" width={40} height={40} />
              <span>{ITEM[d]!.name[lang]}</span>
            </button>
          ))}
        {job.id === "courier" &&
          HOUSES.map((h, i) => (
            <button key={h.en} type="button" className="shift-choice" onClick={() => pick(i)}>
              <span className="shift-house" style={{ background: h.color }}>
                <Icon name="home" size={24} />
              </span>
              <span>{L(`The ${h.en} house`, `${h.zh}色的房子`)}</span>
            </button>
          ))}
        {job.id === "watch" && (
          <>
            <button type="button" className="shift-choice" onClick={() => pick(0)}>
              <Icon name="heart" size={22} />
              <span>{L("Let them in", "请进")}</span>
            </button>
            <button type="button" className="shift-choice" onClick={() => pick(1)}>
              <Icon name="hand" size={22} />
              <span>{L("Wave them away", "劝走")}</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
