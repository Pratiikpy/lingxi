/**
 * Weekly seasons (PRD F25, A5): enter the pet's brain with one tap; every entry
 * spars every other entry from both sides; the table can be recomputed in the
 * browser from the public entry list; ties go to the smaller brain.
 */

import { useCallback, useEffect, useState } from "react";
import { type Pet, dayOf, petCard, placeTier, previousWeek, seasonStandings, stageOf, standingsDigest, weekOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { type SeasonView, enterSeason, markAwarded, mine, readSeason } from "../game/season";
import { useBadges } from "../game/badges";
import { play } from "../game/sound";
import "./season.css";

const SHOWN = 10;

function left(ms: number, lang: string): string {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  const d = Math.floor(h / 24);
  return lang === "zh" ? (d > 0 ? `${d} 天 ${h % 24} 小时` : `${h} 小时`) : d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

export function SeasonCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [view, setView] = useState<SeasonView | null>(null);
  const [last, setLast] = useState<SeasonView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<{ same: boolean; digest: string } | null>(null);
  const week = weekOf(Date.now());

  const load = useCallback(async () => {
    setState("loading");
    const [v, l] = await Promise.all([readSeason(week), readSeason(previousWeek(week))]);
    setView(v);
    setLast(l);
    setState(v ? "ready" : "error");
    // a finished season turns our final place into a badge, once
    const m = mine();
    const key = l ? m.keys[l.week] : undefined;
    if (l?.closed && key && !m.awarded.includes(l.week)) {
      const row = l.standings.find((r) => r.key === key);
      const tier = row ? placeTier(row.rank) : 0;
      if (tier) useBadges.getState().note("seasonPlace", tier);
      markAwarded(l.week);
    }
  }, [week]);
  useEffect(() => {
    void load();
  }, [load]);

  const myKey = mine().keys[week];
  const enter = async () => {
    setBusy(true);
    setNote("");
    const r = await enterSeason({ name: pet.name, line: pet.line, stage: stageOf(pet, Date.now()), card: petCard(pet), story: { days: dayOf(pet, Date.now()), lessons: pet.lessons.length, nature: [] } });
    setBusy(false);
    if (r.ok) {
      play("success");
      setNote(myKey ? L(`${pet.name}'s entry is updated with what it knows now.`, `已用${pet.name}现在学会的东西更新参赛。`) : L(`${pet.name} is in this week's season.`, `${pet.name}已参加本周赛季。`));
      setCheck(null);
      await load();
    } else {
      play("error");
      setNote(
        r.reason === "full"
          ? L("This week's season is full. A new one opens on Monday.", "本周赛季已满，周一开新赛季。")
          : r.reason === "busy"
            ? L("Too many entries from here just now. Try again in a little while.", "这里刚刚提交太多次了，过一会儿再试。")
            : L("The season couldn't be reached. Try again in a moment.", "暂时连不上赛季，过一会儿再试。"),
      );
    }
  };

  const recompute = () => {
    if (!view) return;
    const rows = seasonStandings(view.week, view.entries);
    const digest = standingsDigest(rows);
    setCheck({ same: digest === view.digest, digest });
    play(digest === view.digest ? "success" : "error");
  };

  const rows = view?.standings ?? [];
  const mineRow = rows.find((r) => r.key === myKey);
  const shown = rows.slice(0, SHOWN);
  const champ = last?.closed ? last.standings[0] : undefined;
  const lastMine = last ? last.standings.find((r) => r.key === mine().keys[last.week]) : undefined;

  return (
    <section className="ss-card" aria-label={L("Weekly season", "每周赛季")}>
      <div className="ss-head">
        <div>
          <p className="label">{L(`Weekly season · ${week}`, `每周赛季 · ${week}`)}</p>
          <p className="small">
            {view
              ? L(`${view.entries.length} entered · ends in ${left(view.ends - Date.now(), lang)} · every pet fights every other, from both sides; level on points, the smaller brain ranks higher.`, `${view.entries.length} 只参赛 · ${left(view.ends - Date.now(), lang)}后结束 · 每只宠物和其他每只各打两场（左右各一）；同分时大脑更小的排前面。`)
              : state === "error"
                ? L("The season couldn't be reached.", "暂时连不上赛季。")
                : L("Reading this week's season…", "正在读取本周赛季……")}
          </p>
        </div>
        {state === "error" ? (
          <button type="button" className="btn" onClick={() => void load()}>
            {L("Retry", "重试")}
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={busy || state !== "ready"} onClick={() => void enter()}>
            {busy ? L("Entering…", "提交中……") : myKey ? L("Update entry", "更新参赛") : L(`Enter ${pet.name}`, `让${pet.name}参赛`)}
          </button>
        )}
      </div>
      {note && (
        <p className="small ss-note" aria-live="polite">
          {note}
        </p>
      )}
      {champ && (
        <p className="small ss-last">
          {L(`Last week (${last!.week}): ${champ.name} won with ${champ.points} points.`, `上周（${last!.week}）：${champ.name}以 ${champ.points} 分夺冠。`)}
          {lastMine ? L(` Your pet finished ${lastMine.rank} of ${last!.standings.length}.`, ` 你的宠物排第 ${lastMine.rank} / ${last!.standings.length}。`) : ""}
        </p>
      )}
      {rows.length > 0 && (
        <table className="ss-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{L("Pet", "宠物")}</th>
              <th scope="col">{L("Pts", "分")}</th>
              <th scope="col">{L("W-D-L", "胜-平-负")}</th>
              <th scope="col">{L("Gates", "门")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className={r.key === myKey ? "is-mine" : undefined}>
                <td>{r.rank}</td>
                <td>{r.name}</td>
                <td>{r.points}</td>
                <td>{`${r.wins}-${r.draws}-${r.losses}`}</td>
                <td>{r.gates}</td>
              </tr>
            ))}
            {mineRow && mineRow.rank > SHOWN && (
              <tr className="is-mine">
                <td>{mineRow.rank}</td>
                <td>{mineRow.name}</td>
                <td>{mineRow.points}</td>
                <td>{`${mineRow.wins}-${mineRow.draws}-${mineRow.losses}`}</td>
                <td>{mineRow.gates}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {view && view.entries.length > 0 && (
        <div className="ss-check">
          <button type="button" className="link" onClick={recompute}>
            {L("Recompute the table in your browser", "在你的浏览器里重算这张表")}
          </button>
          {check && (
            <span className={`small ${check.same ? "ss-ok" : "ss-bad"}`}>
              {check.same
                ? L(`Same table: all ${view.entries.length * (view.entries.length - 1)} bouts re-fought here, fingerprint ${check.digest}.`, `同一张表：这里重打了全部 ${view.entries.length * (view.entries.length - 1)} 场，指纹 ${check.digest}。`)
                : L(`Different table here (fingerprint ${check.digest}, the server says ${view.digest}).`, `这里算出的表不同（指纹 ${check.digest}，服务器是 ${view.digest}）。`)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
