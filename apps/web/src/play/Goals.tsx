/**
 * The Together tab of the quest book (plan 4.10): the community goals. Each card carries the giver's ask, the
 * shared total against the target with the four tier marks, the time left, what each tier gives and whether it is
 * reached, the player's own part, the button to take what is waiting, and who helped most. Every number comes
 * from X Layer through our server; the card says how it is counted.
 */

import { useEffect, useState } from "react";
import { CHARACTERS, GOALS, GOAL_METHOD, type GoalDef, goalAmountText, type Reward, TIER_PCTS, type TierPct, claimsOf, goalProgress, nextTier, tierAt } from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { useWorld } from "../game/world";
import { type GoalReport, takeGoalEveryone, takeGoalTiers, useGoals, waitingIn } from "../game/goals";
import { rewardText } from "./Quests";
import "./goals.css";
import { now as gameNow } from "../game/gameClock";

type Lang = "en" | "zh";
const LIVE_SITE = "https://lingxi.knole.me/play.html";

export const amountText = goalAmountText;

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** Time left (or to the start), in days or hours, from the server's clock. */
function timeText(g: GoalDef, r: GoalReport | undefined, now: number, lang: Lang): string {
  const zh = lang === "zh";
  const span = (s: number) => {
    const d = Math.floor(s / 86_400);
    const h = Math.max(1, Math.ceil((s % 86_400) / 3_600));
    return d >= 1 ? (zh ? `${d} 天` : `${d} day${d > 1 ? "s" : ""}`) : zh ? `${h} 小时` : `${h} hour${h > 1 ? "s" : ""}`;
  };
  const state = r?.state ?? (now < g.start ? "upcoming" : now >= g.end ? "ended" : "open");
  if (state === "complete") return zh ? "完成了！" : "Complete!";
  if (state === "upcoming") return zh ? `${span(g.start - now)}后开始` : `Starts in ${span(g.start - now)}`;
  if (state === "ended") return zh ? "已结束" : "Ended";
  return zh ? `还剩 ${span(g.end - now)}` : `${span(g.end - now)} left`;
}

function RewardList({ rewards, lang }: { rewards: readonly Reward[]; lang: Lang }) {
  const shown = rewards.map((r) => rewardText(r, lang)).filter((x): x is string => !!x);
  return (
    <ul className="gl-rewards">
      {shown.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function GoalCard({ g }: { g: GoalDef }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const world = useWorld((s) => s.world);
  const { reports, now, wallets } = useGoals();
  const r = reports[g.id];
  const total = r?.total ?? 0;
  const mine = r?.mine ?? 0;
  const giver = CHARACTERS.find((c) => c.id === g.giver);
  const taken = claimsOf(world).tiers[g.id] ?? [];
  const waiting = waitingIn(g.id);
  const next = nextTier(g, total);
  const [got, setGot] = useState<string | null>(null);
  const [board, setBoard] = useState(false);
  const pct = goalProgress(g, total);
  const unit = g.unit[lang];
  const take = () => {
    const res = takeGoalTiers(g.id);
    if (res) setGot(res.rewards.map((x) => rewardText(x, lang)).filter(Boolean).join(lang === "zh" ? "、" : ", "));
  };
  const takeAll = () => {
    const res = takeGoalEveryone(g.id);
    if (res) setGot(res.map((x) => rewardText(x, lang)).filter(Boolean).join(lang === "zh" ? "、" : ", "));
  };
  const you = new Set(wallets);
  return (
    <li className={`gl gl-${r?.state ?? "open"}`}>
      <div className="gl-head">
        {giver && <img className="gl-face" src={`art/npcs/${g.story[0]?.face ?? giver.stand}`} width={44} height={44} alt="" aria-hidden="true" />}
        <div>
          <b className="gl-title">{g.title[lang]}</b>
          <span className="gl-from">
            {L(`From ${giver?.name.en ?? g.giver}`, `来自${giver?.name.zh ?? g.giver}`)} · <span className="gl-time">{timeText(g, r, now || Math.floor(gameNow() / 1000), lang)}</span>
          </span>
        </div>
      </div>
      <div className="gl-ask">
        {g.story.map((l, i) => (
          <p key={i}>{l[lang]}</p>
        ))}
      </div>

      <div className="gl-meter" role="meter" aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(total, g.target)} aria-label={`${g.title[lang]}: ${amountText(g, total)} / ${amountText(g, g.target)} ${unit}`}>
        <div className="gl-count">
          <b>{amountText(g, total)}</b>
          <span>
            / {amountText(g, g.target)} {unit}
          </span>
        </div>
        <div className="gl-bar">
          <b style={{ transform: `scaleX(${pct})` }} />
          {TIER_PCTS.map((p) => (
            <i key={p} className={total >= tierAt(g, p) ? "on" : ""} style={{ left: `${p}%` }} aria-hidden="true" />
          ))}
        </div>
        <p className="small gl-next">
          {r?.state === "upcoming"
            ? L("Counting starts the moment it opens; nothing done before then counts.", "开始那一刻才计数，之前做的不算。")
            : next === null
            ? L("Every tier reached. Thank you, everyone.", "每一档都达到了。谢谢大家。")
            : L(`${amountText(g, tierAt(g, next) - total)} more for the ${next}% tier.`, `再 ${amountText(g, tierAt(g, next) - total)} 就到 ${next}% 档。`)}
          {r && r.contributors > 0 ? L(` ${r.contributors} helping so far.`, ` 已有 ${r.contributors} 人出力。`) : ""}
        </p>
      </div>

      <ol className="gl-tiers">
        {TIER_PCTS.map((p) => {
          const reached = total >= tierAt(g, p);
          const mineTaken = taken.includes(p as TierPct);
          return (
            <li key={p} className={`${reached ? "reached" : ""}${mineTaken ? " taken" : ""}`}>
              <span className="gl-tier-head">
                <b>{p}%</b>
                <span>{reached ? (mineTaken ? L("Taken", "已领") : L("Reached", "已达到")) : L(`at ${amountText(g, tierAt(g, p as TierPct))}`, `满 ${amountText(g, tierAt(g, p as TierPct))}`)}</span>
              </span>
              <RewardList rewards={g.tiers[p as TierPct]} lang={lang} />
            </li>
          );
        })}
      </ol>
      <p className="small gl-stack">{L("Tiers stack: reaching one pays every tier below it too. A goal that ends short still pays the tiers it reached.", "各档叠加：达到一档，下面的每一档也都给。目标没完成也照样给已达到的档。")}</p>

      <div className="gl-everyone">
        <span className="gl-tag">{L("For everyone", "人人有份")}</span>
        <span>{g.everyone.text[lang]}</span>
      </div>

      <div className="gl-mine">
        {!wallets.length ? (
          <span className="small">{L("Keep your pet on X Layer (the Pet tab, then “Keep … on X Layer”) and what you do starts to count here.", "把宠物放上 X Layer（宠物页里的“把……放上 X Layer”），你做的事就会算进来。")}</span>
        ) : mine > 0 ? (
          <span>
            {L("You gave ", "你出了 ")}
            <b>{amountText(g, mine)}</b>
            {total > 0 ? L(` (${Math.round((mine / total) * 100)}% of it)`, `（占 ${Math.round((mine / total) * 100)}%）`) : ""}
          </span>
        ) : (
          <span className="small">{L("You haven't helped with this one yet.", "这个你还没出力。")}</span>
        )}
        <div className="gl-actions">
          {waiting.tiers.length > 0 && (
            <button type="button" className="btn primary" onClick={() => (play("tap"), take())}>
              {L(`Take ${waiting.tiers.length > 1 ? `${waiting.tiers.length} tiers` : "it"}`, waiting.tiers.length > 1 ? `领取 ${waiting.tiers.length} 档` : "领取")}
            </button>
          )}
          {waiting.everyone && (
            <button type="button" className="btn" onClick={() => (play("tap"), takeAll())}>
              {L("Take the gift for everyone", "领取人人有份的礼物")}
            </button>
          )}
        </div>
        {got && (
          <p className="gl-got" role="status">
            {L("You got: ", "你得到了：")}
            {got}
          </p>
        )}
      </div>

      <p className="small gl-how">{GOAL_METHOD[g.metric][lang]}</p>

      <button type="button" className="gl-board-toggle" aria-expanded={board} onClick={() => (play("tap"), setBoard((b) => !b))}>
        {L(`Who helped${r?.contributors ? ` (${r.contributors})` : ""}`, `谁出了力${r?.contributors ? `（${r.contributors}）` : ""}`)} {board ? "▴" : "▾"}
      </button>
      {board &&
        (r && r.top.length ? (
          <ol className="gl-board">
            {r.top.map((t, i) => (
              <li key={t.wallet} className={`${i < 3 ? `podium p${i + 1}` : ""}${you.has(t.wallet) ? " you" : ""}`}>
                <span className="gl-rank">{i + 1}</span>
                <a href={`https://www.oklink.com/xlayer/address/${t.wallet}`} target="_blank" rel="noopener noreferrer">
                  {you.has(t.wallet) ? L("You", "你") : short(t.wallet)}
                </a>
                <span className="gl-n">{amountText(g, t.n)}</span>
                <span className="gl-share">{Math.round(t.share * 100)}%</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="small qb-empty">{L("No one has helped yet. Be the first.", "还没有人出力。来做第一个吧。")}</p>
        ))}
    </li>
  );
}

/** The Together tab: every goal, with the states for loading, no server, and a failed read. */
export function TogetherPanel() {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { status, refresh } = useGoals();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (status === "offline")
    return (
      <p className="small qb-empty">
        {L("Goals are counted from X Layer by the live site. Open it there to join in: ", "共同目标由在线版从 X Layer 统计。去那里参加：")}
        <a href={LIVE_SITE} target="_blank" rel="noopener noreferrer">
          lingxi.knole.me
        </a>
      </p>
    );
  if (status === "idle" || status === "loading") return <p className="small qb-empty gl-loading">{L("Reading X Layer…", "正在读取 X Layer……")}</p>;
  if (status === "error")
    return (
      <div className="qb-empty">
        <p className="small">{L("Couldn't reach the server that counts the goals.", "连不上统计目标的服务器。")}</p>
        <button type="button" className="btn small-btn" onClick={() => (play("tap"), void refresh())}>
          {L("Try again", "再试一次")}
        </button>
      </div>
    );
  return (
    <>
      <p className="small qb-note">{L("Everyone on X Layer works towards these together. What counts is read from the chain, so it is the same for every player.", "X Layer 上的每个人一起完成这些目标。统计的数都从链上读，对每个玩家都一样。")}</p>
      <ul className="gl-list">
        {GOALS.map((g) => (
          <GoalCard key={g.id} g={g} />
        ))}
      </ul>
    </>
  );
}

/** Whether the Together tab has something waiting, for its dot. */
export const togetherWaiting = (): boolean => GOALS.some((g) => {
  const w = waitingIn(g.id);
  return w.tiers.length > 0 || w.everyone;
});
