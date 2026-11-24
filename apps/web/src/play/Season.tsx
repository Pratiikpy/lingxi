/**
 * Weekly seasons (PRD F25, A5): enter the pet's brain with one tap; every entry
 * spars every other entry from both sides; the table can be recomputed in the
 * browser from the public entry list; ties go to the smaller brain.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Pet,
  SPAR_VERSION,
  dayOf,
  petCard,
  placeTier,
  previousWeek,
  seasonSparVersion,
  shownName,
  stageOf,
  weekOf,
} from "@lingxi/game";
import { useLang } from "../i18n";
import { type SeasonView, enterSeason, markAwarded, mine, readSeason, seasonsAvailable } from "../game/season";
import { useBadges } from "../game/badges";
import { play } from "../game/sound";
import { signSeasonEntry, recordOf } from "../game/chain";
import { useWorld } from "../game/world";
import { useMail } from "../game/mail";
import { now } from "../game/gameClock";
import { refight } from "../game/seasonCheck";

const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
import "./season.css";
import { sitePage } from "@lingxi/chain/site";

const SHOWN = 10;

function left(ms: number, lang: string): string {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  const d = Math.floor(h / 24);
  return lang === "zh" ? (d > 0 ? `${d} 天 ${h % 24} 小时` : `${h} 小时`) : d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

/** While the server is still working out standings, how often and how many times the card asks again (A38). */
const PENDING_ASK_MS = 3_000;
const PENDING_ASKS = 20;

export function SeasonCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang);
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const [view, setView] = useState<SeasonView | null>(null);
  const [last, setLast] = useState<SeasonView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const serverless = !seasonsAvailable();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [check, setCheck] = useState<{ same: boolean; digest: string } | null>(null);
  /** the recompute under way, fought in a worker (A84); ended if the sheet closes */
  const [checking, setChecking] = useState(false);
  const refighting = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => refighting.current?.stop(), []);
  const week = weekOf(now());

  // this week's season and last week's, as the server holds them now
  const readBoth = useCallback(() => Promise.all([readSeason(week), readSeason(previousWeek(week))]), [week]);
  const show = useCallback(([v, l]: Awaited<ReturnType<typeof readBoth>>) => {
    setView(v);
    setLast(l);
    setState(v ? "ready" : "error");
    // a finished season turns our final place into a badge, once
    const m = mine();
    const key = l ? m.keys[l.week] : undefined;
    // a place is awarded only from standings fought for the week's own entries, never from ones still being worked out
    if (l?.closed && !l.pending && key && !m.awarded.includes(l.week)) {
      const row = l.standings.find((r) => r.key === key);
      const tier = row ? placeTier(row.rank) : 0;
      if (tier) useBadges.getState().note("seasonPlace", tier);
      if (row) {
        const award = l.award;
        const sent = tier === 3 && award?.brainId && award.to;
        useMail.getState().write({
          id: `season-${l.week}`,
          at: l.ends,
          subject: {
            en: `Season ${l.week}: ${row.rank === 1 ? "champion!" : `${ordinal(row.rank)} of ${l.standings.length}`}`,
            zh: `${l.week} 赛季：${row.rank === 1 ? "冠军！" : `第 ${row.rank} 名，共 ${l.standings.length} 只`}`,
          },
          body: {
            en: `${row.name} finished ${ordinal(row.rank)} with ${row.points} points (${row.wins} wins, ${row.draws} draws, ${row.losses} losses).${tier ? " A Season star badge is yours." : ""}${tier === 3 ? " The champion's laurel is in your wardrobe." : ""}${sent ? ` Its brain was taped out as circuit #${award!.brainId} and sent to ${award!.to!.slice(0, 6)}…${award!.to!.slice(-4)}.` : ""}`,
            zh: `${row.name}以 ${row.points} 分排第 ${row.rank}（${row.wins} 胜 ${row.draws} 平 ${row.losses} 负）。${tier ? "你获得了赛季之星徽章。" : ""}${tier === 3 ? "冠军桂冠已放进你的衣橱。" : ""}${sent ? `它的大脑已流片为 #${award!.brainId} 号电路，送到了 ${award!.to!.slice(0, 6)}…${award!.to!.slice(-4)}。` : ""}`,
          },
        });
      }
      // the champion's keepsake outfit (F26)
      if (tier === 3) useWorld.getState().giveLaurel();
      markAwarded(l.week);
    }
  }, []);
  const load = useCallback(() => {
    setState("loading");
    return readBoth().then(show);
  }, [readBoth, show]);
  // read when the card opens (it starts out loading), and again while the server is still working out standings (A38)
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = (left: number) =>
      readBoth().then((r) => {
        if (!live) return;
        show(r);
        if ((r[0]?.pending || r[1]?.pending) && left > 0) timer = setTimeout(() => void read(left - 1), PENDING_ASK_MS);
      });
    void read(PENDING_ASKS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [readBoth, show]);

  const myKey = mine().keys[week];
  const enter = async () => {
    setBusy(true);
    setNote("");
    const entry = {
      name: pet.name,
      line: pet.line,
      stage: stageOf(pet, now()),
      card: petCard(pet),
      story: { days: dayOf(pet, now()), lessons: pet.lessons.length, nature: [] },
    };
    // a pet on X Layer enters as itself, signed, so it can win the keepsake; if that cannot be proven it still plays
    let proof: Awaited<ReturnType<typeof signSeasonEntry>> = null;
    let why: "unsigned" | "notProven" | null = null;
    if (onChain) {
      try {
        proof = await signSeasonEntry(pet, entry);
      } catch {
        why = "unsigned";
      }
    }
    let r = await enterSeason(entry, proof ?? undefined);
    // the server is checking many pets on X Layer just now: nothing was entered, and trying again is the answer (A62)
    const checkerBusy = !r.ok && r.reason === "notProven" && r.detail === "busy";
    if (!r.ok && r.reason === "notProven" && !checkerBusy) {
      why = "notProven";
      r = await enterSeason(entry);
    }
    setBusy(false);
    if (r.ok) {
      play("success");
      const base = myKey
        ? L(`${pet.name}'s entry is updated with what it knows now.`, `已用${pet.name}现在学会的东西更新参赛。`)
        : L(`${pet.name} is in this week's season.`, `${pet.name}已参加本周赛季。`);
      setNote(
        why === "notProven"
          ? `${base} ${L(`Its mind on X Layer is behind what it knows now, so this entry can't win the keepsake. Put its new mind on chain (Pet sheet), then update the entry.`, `它在 X Layer 上的心智落后于它现在学会的，所以这次参赛不能赢纪念品。先在宠物页把新心智放上链，再更新参赛。`)}`
          : why === "unsigned"
            ? `${base} ${L("Without your signature this entry can't win the keepsake; update it and sign to be in line.", "没有你的签名，这次参赛不能赢纪念品；更新参赛并签名就能排上。")}`
            : r.proven
              ? `${base} ${L("It's entered as itself on X Layer, so the keepsake can be yours.", "它以 X Layer 上的身份参赛，纪念品可以归你。")}`
              : base,
      );
      setCheck(null);
      await load();
    } else {
      play("error");
      setNote(
        r.reason === "full"
          ? L("This week's season is full. A new one opens on Monday.", "本周赛季已满，周一开新赛季。")
          : r.reason === "tooMany"
            ? L(
                "Three pets from here are already in this week's season. A new one opens on Monday.",
                "这里已经有三只宠物参加本周赛季了，周一开新赛季。",
              )
            : r.reason === "busy"
              ? L(
                  "Too many entries from here just now. Try again in a little while.",
                  "这里刚刚提交太多次了，过一会儿再试。",
                )
              : checkerBusy
                ? L(
                    "Lingxi is checking many pets against X Layer just now, so nothing was entered. Try again in a minute.",
                    "灵犀正在对照 X Layer 核对很多只宠物，所以这次没有参赛。过一分钟再试。",
                  )
                : L("The season couldn't be reached. Try again in a moment.", "暂时连不上赛季，过一会儿再试。"),
      );
    }
  };

  const recompute = async () => {
    if (!view || refighting.current) return;
    setCheck(null);
    setChecking(true);
    const job = refight({ week: view.week, entries: view.entries });
    refighting.current = job;
    try {
      const digest = await job.done;
      setCheck({ same: digest === view.digest, digest });
      play(digest === view.digest ? "success" : "error");
    } catch {
      // stopped: the sheet closed
    } finally {
      refighting.current = null;
      setChecking(false);
    }
  };

  const rows = view?.standings ?? [];
  /** every entry against every other, from both sides */
  const bouts = view
    ? (view.entries.length * (view.entries.length - 1)).toLocaleString(lang === "zh" ? "zh-CN" : "en")
    : "";
  const mineRow = rows.find((r) => r.key === myKey);
  const shown = rows.slice(0, SHOWN);
  const champ = last?.closed && !last.pending ? last.standings[0] : undefined;
  const lastMine = last && !last.pending ? last.standings.find((r) => r.key === mine().keys[last.week]) : undefined;
  const onChain = !!recordOf(pet);
  const award = last?.award;
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  return (
    <section className="ss-card" aria-label={L("Weekly season", "每周赛季")}>
      <div className="ss-head">
        <div>
          <p className="label">{L(`Weekly season · ${week}`, `每周赛季 · ${week}`)}</p>
          <p className="small">
            {view
              ? seasonSparVersion(week) === SPAR_VERSION
                ? L(
                    `${view.entries.length} entered · ends in ${left(view.ends - now(), lang)} · every pet fights every other, from both sides; level on points, the smaller brain ranks higher.`,
                    `${view.entries.length} 只参赛 · ${left(view.ends - now(), lang)}后结束 · 每只宠物和其他每只各打两场（左右各一）；同分时大脑更小的排前面。`,
                  )
                : L(
                    `${view.entries.length} entered · ends in ${left(view.ends - now(), lang)} · every pet fights every other, from both sides; level on points, more wins ranks higher.`,
                    `${view.entries.length} 只参赛 · ${left(view.ends - now(), lang)}后结束 · 每只宠物和其他每只各打两场（左右各一）；同分时赢得多的排前面。`,
                  )
              : serverless
                ? L(
                    "Weekly seasons are run by Lingxi's server, which this on-chain copy of the game doesn't use. Enter them on lingxi.knole.me.",
                    "每周赛季由灵犀的服务器举办，这份链上版本不使用服务器。请到 lingxi.knole.me 参赛。",
                  )
                : state === "error"
                  ? L("The season couldn't be reached.", "暂时连不上赛季。")
                  : L("Reading this week's season…", "正在读取本周赛季……")}
          </p>
        </div>
        {serverless ? (
          <a className="btn" href={sitePage("play.html")} target="_blank" rel="noopener noreferrer">
            {L("Open the full site", "打开完整版")}
          </a>
        ) : state === "error" ? (
          <button type="button" className="btn" onClick={() => void load()}>
            {L("Retry", "重试")}
          </button>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={busy || state !== "ready"}
            onClick={() => void enter()}
          >
            {busy
              ? L("Entering…", "提交中……")
              : myKey
                ? L("Update entry", "更新参赛")
                : L(`Enter ${pet.name}`, `让${pet.name}参赛`)}
          </button>
        )}
      </div>
      <p className="small ss-prize">
        {onChain
          ? L(
              `The best-placed pet kept on X Layer has its brain taped out and the circuit sent to its owner. ${pet.name} is on X Layer: entering asks you to sign once (no fee) so the entry is proven to be it.`,
              `排名最高的、放在 X Layer 上的宠物，它的大脑会流片，电路送到主人手里。${pet.name}在 X Layer 上：参赛时请签一次名（不收费），证明这就是它。`,
            )
          : L(
              `The best-placed pet kept on X Layer has its brain taped out and the circuit sent to its owner. Put ${pet.name} on X Layer first to be in line for it.`,
              `排名最高的、放在 X Layer 上的宠物，它的大脑会流片，电路送到主人手里。想排上，先把${pet.name}放上 X Layer。`,
            )}
      </p>
      {note && (
        <p className="small ss-note" aria-live="polite">
          {note}
        </p>
      )}
      {champ && (
        <p className="small ss-last">
          {L(
            `Last week (${last!.week}): ${shownName(champ.name, 24)} won with ${champ.points} points.`,
            `上周（${last!.week}）：${shownName(champ.name, 24)}以 ${champ.points} 分夺冠。`,
          )}
          {lastMine
            ? L(
                ` Your pet finished ${lastMine.rank} of ${last!.standings.length}.`,
                ` 你的宠物排第 ${lastMine.rank} / ${last!.standings.length}。`,
              )
            : ""}
          {award?.brainId && award.to ? (
            <>
              {" "}
              {L(
                `Its brain was taped out on X Layer as circuit #${award.brainId} and sent to ${short(award.to)}.`,
                `它的大脑已在 X Layer 上流片为 #${award.brainId} 号电路，送到了 ${short(award.to)}。`,
              )}{" "}
              {award.sendTx && (
                <a href={`https://www.oklink.com/xlayer/tx/${award.sendTx}`} target="_blank" rel="noopener noreferrer">
                  {L("See it", "查看")}
                </a>
              )}
            </>
          ) : award?.none === "noWallet" ? (
            L(
              " It wasn't on X Layer, so there was no wallet to send its circuit to.",
              " 它不在 X Layer 上，所以没有钱包可以接收它的电路。",
            )
          ) : award?.none === "failed" ? (
            L(" Its circuit couldn't be sent this time.", " 这次没能把它的电路送出。")
          ) : (
            ""
          )}
        </p>
      )}
      {view?.pending && (
        <p className="small ss-pending" aria-live="polite">
          {rows.length
            ? L(
                "The table is being worked out again for the newest entries; this is the last one.",
                "正在为最新的参赛重新计算排名；下面是上一次的结果。",
              )
            : L(
                "The table is being worked out: every pet fights every other, which takes a few seconds.",
                "正在计算排名：每只宠物都要和其他每只打一场，需要几秒钟。",
              )}
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
                <td>{shownName(r.name, 24)}</td>
                <td>{r.points}</td>
                <td>{`${r.wins}-${r.draws}-${r.losses}`}</td>
                <td>{r.gates}</td>
              </tr>
            ))}
            {mineRow && mineRow.rank > SHOWN && (
              <tr className="is-mine">
                <td>{mineRow.rank}</td>
                <td>{shownName(mineRow.name, 24)}</td>
                <td>{mineRow.points}</td>
                <td>{`${mineRow.wins}-${mineRow.draws}-${mineRow.losses}`}</td>
                <td>{mineRow.gates}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {view && view.entries.length > 0 && !view.pending && (
        <div className="ss-check">
          <button
            type="button"
            className="link"
            onClick={() => void recompute()}
            disabled={checking}
            aria-busy={checking}
          >
            {checking
              ? L(`Re-fighting all ${bouts} bouts…`, `正在重打全部 ${bouts} 场……`)
              : L("Recompute the table in your browser", "在你的浏览器里重算这张表")}
          </button>
          {check && (
            <span className={`small ${check.same ? "ss-ok" : "ss-bad"}`}>
              {check.same
                ? L(
                    `Same table: all ${bouts} bouts re-fought here, fingerprint ${check.digest}.`,
                    `同一张表：这里重打了全部 ${bouts} 场，指纹 ${check.digest}。`,
                  )
                : L(
                    `Different table here (fingerprint ${check.digest}, the server says ${view.digest}).`,
                    `这里算出的表不同（指纹 ${check.digest}，服务器是 ${view.digest}）。`,
                  )}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
