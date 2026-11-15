/**
 * School and jobs as life stages (PRD M8, after Tamagotchi Connection's jobs).
 * A child or teen goes to Pet School; a grown pet takes shifts at a job, a short
 * mini-game the owner plays, paid in in-game coins only.
 *
 * What the pet has been taught matters at work: before a shift its own brain is
 * asked what it wants in the job's situations, and a pet whose mind suits the
 * work earns more. Each round is drawn from the shift's seed, so a shift replays
 * the same everywhere.
 */

import { type Program, encodeSenses, runBeat, stateBits } from "@lingxi/brain";
import type { Stage } from "./pet";

export type JobId = "cafe" | "courier" | "watch";

export interface Job {
  id: JobId;
  name: { en: string; zh: string };
  how: { en: string; zh: string };
  /** the wants that suit this work (idle 0, eat 1, play 2, sleep 3, explore 4, sulk 5, cuddle 6, share 7) */
  suits: readonly number[];
  /** the situations the pet's mind is asked about before a shift */
  situations: ReadonlyArray<Partial<Record<"hunger" | "joy" | "energy" | "clean" | "time" | "action" | "event" | "owner", number>>>;
  /** what a round asks for: one of `choices` is right */
  choices: number;
}

export const JOBS: readonly Job[] = [
  {
    id: "cafe",
    name: { en: "Café helper", zh: "咖啡馆帮手" },
    how: { en: "Each guest shows what they'd like. Bring the matching dish before they lose patience.", zh: "每位客人会显示想要什么。在他们等不及之前端上对的那一道。" },
    suits: [6, 7],
    situations: [{ event: 1 }, { event: 1, time: 2 }, { action: 5 }, { event: 1, owner: 1 }],
    choices: 4,
  },
  {
    id: "courier",
    name: { en: "Parcel runner", zh: "送包裹" },
    how: { en: "A parcel comes with a colour. Take it to the house of the same colour.", zh: "每个包裹都有颜色，送到同样颜色的房子去。" },
    suits: [2, 4],
    situations: [{ energy: 3 }, { energy: 2, time: 1 }, { event: 2 }, { action: 2 }],
    choices: 3,
  },
  {
    id: "watch",
    name: { en: "Night watch", zh: "守夜" },
    how: { en: "Shapes appear at the gate. Let friends in; wave strangers away.", zh: "门口会出现身影。朋友请进，陌生的劝走。" },
    suits: [4],
    situations: [{ time: 0 }, { time: 0, event: 3 }, { time: 3, event: 3 }, { time: 0, event: 1 }],
    choices: 2,
  },
];

export const JOB: Readonly<Record<JobId, Job>> = Object.fromEntries(JOBS.map((j) => [j.id, j])) as Record<JobId, Job>;

/** Shifts a pet may work in one day, and how long a shift lasts. */
export const SHIFTS_PER_DAY = 3;
export const SHIFT_SECONDS = 30;
/** Coins for each right answer (less one for each wrong one), and the most a shift pays before the fit bonus. */
export const PAY_PER_ROUND = 1;
export const BASE_SHIFT_PAY = 24;
/** Seconds a guest waits before leaving unserved. */
export const PATIENCE_SECONDS = 4;
/** The most a shift can pay: a pet whose mind suits the work raises the ceiling too. */
export const maxShiftPay = (fit: number): number => Math.round(BASE_SHIFT_PAY * fitBonus(fit));

export type LifeStage = "egg" | "baby" | "school" | "work";

/** What a pet does with its days at this stage. */
export function lifeOf(stage: Stage): LifeStage {
  if (stage === "egg" || stage === "baby") return stage;
  if (stage === "child" || stage === "teen") return "school";
  return "work";
}

/**
 * How well a pet's mind suits a job: the share of the job's situations in which
 * its own brain wants something the work needs. 0, 0.25, 0.5, 0.75 or 1.
 */
export function jobFit(program: Program, job: Job): number {
  const calm = { hunger: 0, joy: 2, energy: 2, clean: 2, time: 2, action: 0, event: 0, owner: 1 };
  let suited = 0;
  for (const s of job.situations) {
    const r = runBeat(program, new Array(stateBits(program)).fill(0), encodeSenses({ ...calm, ...s }));
    if (job.suits.includes(r.out & 7)) suited++;
  }
  return suited / job.situations.length;
}

/** The pay multiplier a fit earns: from 1× (no fit) to 1.5× (a perfect fit). */
export const fitBonus = (fit: number): number => 1 + Math.round(fit * 4) / 8;

/** A shift's pay: right answers less wrong ones, times the fit bonus, up to that fit's ceiling. */
export function shiftPay(right: number, wrong: number, fit: number): number {
  return Math.min(maxShiftPay(fit), Math.floor(Math.max(0, right - wrong) * PAY_PER_ROUND * fitBonus(fit)));
}

/** The answer for each round of a shift: round i's right choice, from the seed. */
export function shiftRounds(job: Job, seed: number, rounds: number): number[] {
  let s = (seed >>> 0) || 0x9e3779b9;
  const out: number[] = [];
  for (let i = 0; i < rounds; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    out.push(s % job.choices);
  }
  return out;
}

export interface WorkLog {
  /** the day key the count belongs to */
  day: string;
  shifts: number;
  /** coins earned at work, ever */
  earned: number;
}

/** Whether another shift can be worked today, and the log after one is. */
export function canWork(log: WorkLog | undefined, day: string): boolean {
  return !log || log.day !== day || log.shifts < SHIFTS_PER_DAY;
}
export function logShift(log: WorkLog | undefined, day: string, pay: number): WorkLog {
  const today = log && log.day === day ? log.shifts : 0;
  return { day, shifts: today + 1, earned: (log?.earned ?? 0) + pay };
}
