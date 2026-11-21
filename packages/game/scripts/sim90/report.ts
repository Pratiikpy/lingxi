/** The simulator's numbers as a report a person can read: a summary per player type, a few days in detail, the field and the targets. */

import { BALANCE_MEASURED, PLAYER_TYPES, type PlayerDay, type SimNumbers, evaluateTargets, BALANCE_TARGETS } from "../../src";

const pad = (s: string | number, n: number) => String(s).padStart(n);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** The days shown in each player's table; every day is in the --json output. */
const SHOWN = [1, 2, 3, 4, 5, 7, 8, 10, 14, 21, 30, 45, 60, 75, 90];

function dayLine(d: PlayerDay): string {
  return [
    pad(d.day, 3),
    pad(d.stage, 6),
    pad(d.level, 3),
    pad(d.xp, 6),
    pad(d.coinsIn, 5),
    pad(d.coinsOut, 5),
    pad(d.coins, 6),
    pad(d.mistakes, 4),
    pad(d.sick ? "yes" : "", 4),
    pad(d.questsOpen, 4),
    pad(d.dailiesOpen, 4),
    pad(d.recipesReachable, 4),
    pad(d.roomsUnseen, 4),
    pad(d.newThings, 4),
    pad(`${d.lessonFires}/${d.watched}`, 8),
    pad(`${d.gates}/${d.gateBudget}`, 8),
    pad(`${d.sparWins}/${d.spars}`, 8),
  ].join(" ");
}
const HEAD = "day  stage lvl  xp+d   in   out  coins miss sick qst  dly  rcp  rms  new  lesson/w   gates   spar w/n";

export function report(n: SimNumbers): string {
  const out: string[] = [`Lingxi 90-day simulator, seed ${n.seed}, ${n.days} days (every number from the game's own rules)`, ""];
  out.push("Summary by player type");
  out.push("type      level@7 level@30 level@90  L99 day  mistakes  coins in max/day  all affordable  empty days  lesson fires/watched min  first gate refusal");
  for (const t of PLAYER_TYPES) {
    const p = n.players[t];
    const lv = (d: number) => p.days[Math.min(d, p.days.length) - 1]?.level ?? "-";
    out.push(
      [
        t.padEnd(8),
        pad(lv(7), 8),
        pad(lv(30), 8),
        pad(lv(90), 8),
        pad(p.level99Day ?? "never", 8),
        pad(p.mistakes, 9),
        pad(p.maxDailyCoinsIn, 17),
        pad(p.allAffordableDay === null ? "never" : `day ${p.allAffordableDay}`, 15),
        pad(p.daysWithNothingNew, 11),
        pad(pct(p.lessonFiresPerWatchedMinute), 25),
        pad(p.firstTooBigDay === null ? "never" : `day ${p.firstTooBigDay}`, 19),
      ].join(" "),
    );
  }
  for (const t of PLAYER_TYPES) {
    const p = n.players[t];
    out.push("", `${t}: by day (in/out: coins earned and spent; qst/dly: story quests and dailies open; rcp: recipes in reach; rms: rooms never entered; new: things first seen)`);
    out.push(HEAD);
    for (const d of p.days.filter((d) => SHOWN.includes(d.day))) out.push(dayLine(d));
    const lessons = Object.entries(p.byLesson).map(([id, b]) => `${id} ${b.fired}/${b.watched}`);
    if (lessons.length) out.push(`  each school lesson, minutes it decided of minutes watched since taught: ${lessons.join(", ")}`);
  }
  out.push("", `Spar field: ${n.field.brains.length} brains, each pair ${n.field.seeds * 2} spars`);
  const top = [...n.field.brains].sort((a, b) => b.winRate - a.winRate);
  out.push(`  top: ${top.slice(0, 6).map((b) => `${b.id} ${pct(b.winRate)}`).join(", ")}`);
  out.push(`  by kind: ${["starter", "guard", "dodge", "pounce", "reader", "partner"].map((k) => n.field.brains.filter((b) => b.kind === k).map((b) => `${b.id} ${pct(b.winRate)}`).join(", ")).join("; ")}`);
  out.push(`  guard-only vs pounce-only ${pct(n.field.guardVsPounce)}; dodge-only vs pounce-only ${pct(n.field.dodgeVsPounce)}`);
  out.push("", "Lessons watched for ten minutes after teaching (minute first decided, times decided; hours 8, 13, 19, 21)");
  for (const id of [...new Set(n.lessons.map((l) => l.id))]) {
    const ls = n.lessons.filter((l) => l.id === id);
    out.push(`  ${id.padEnd(8)} ${ls.map((l) => `${l.line[0]}${l.hour}:${l.firstFire ?? "-"}/${l.fires}`).join(" ")}`);
  }
  out.push("", targets(n));
  return out.join("\n");
}

export function targets(n: SimNumbers): string {
  const now = evaluateTargets(n);
  const lines = ["Targets (38-PLAN-GAME-DESIGN.md section 2): now / recorded"];
  for (const t of BALANCE_TARGETS) {
    const m = now.find((x) => x.id === t.id)!;
    const rec = BALANCE_MEASURED.targets[t.id]?.status ?? "unrecorded";
    lines.push(`  [${m.met ? "met " : "open"}] ${t.owner} ${t.id} (recorded ${rec}): ${t.target}`);
    lines.push(`         measured: ${m.value}`);
  }
  return lines.join("\n");
}
