/** Care badges: the shelf in the Pet sheet, and a small celebration when a tier is earned. */

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BADGES, type Badge, type Metric, badgeGoal, progressOf, tierOf } from "@lingxi/game";
import { useHoldings } from "../game/holders";
import { useLang } from "../i18n";
import { useBadges } from "../game/badges";
import { Icon, type IconName } from "./icons";
import "./badges.css";
import { useTrial } from "../game/tryIt";
import { useDialogOpen } from "./app/useDialogOpen";

const ICON: Record<Metric, IconName> = {
  care: "heart",
  feed: "bowl",
  play: "ball",
  clean: "sparkle",
  petting: "hand",
  medicine: "pill",
  lessons: "note",
  stage: "star",
  pets: "pet",
  children: "paw",
  sparWins: "star",
  gifts: "gift",
  rooms: "map",
  chainDays: "mind",
  kinship: "heart",
  seasonPlace: "star",
  builders: "map",
  behemothWins: "mind",
  laneParty: "gift",
};
const TIER = { en: ["", "Bronze", "Silver", "Gold"], zh: ["", "铜", "银", "金"] } as const;
const STAGE = { en: ["", "baby", "a child", "a teen", "an adult"], zh: ["", "宝宝", "幼年", "少年", "成年"] } as const;
const PLACE = {
  en: ["", "in the top ten", "in the top three", "first"],
  zh: ["", "进入前十", "进入前三", "拿第一"],
} as const;

/** A badge's next goal: a stage or a season place in words, any other count as the game says it (R65: one, singular). */
function howText(b: Badge, n: number, lang: "en" | "zh"): string {
  const shown =
    b.metric === "stage"
      ? (STAGE[lang][n] ?? String(n))
      : b.metric === "seasonPlace"
        ? (PLACE[lang][n] ?? String(n))
        : String(n);
  return badgeGoal(b, n, lang, shown);
}

export function BadgeShelf() {
  const { lang } = useLang();
  const l = lang as "en" | "zh";
  const ledger = useBadges((s) => s.ledger);
  const earned = BADGES.filter((b) => tierOf(b, ledger) > 0).length;
  const held = useHoldings((h) => h.held);
  return (
    <div className="badges">
      <div className="badges-head">
        <p className="label">{l === "zh" ? "照料徽章" : "Care badges"}</p>
        <span className="small">
          {l === "zh"
            ? `已得 ${earned} / ${BADGES.length}，所有宠物一起累计`
            : `${earned} of ${BADGES.length}, counted across all your pets`}
        </span>
      </div>
      <ul className="badge-grid">
        {BADGES.map((b) => {
          const tier = tierOf(b, ledger);
          const p = progressOf(b, ledger);
          return (
            <li key={b.id} className={`badge t${tier}`} title={p.next !== null ? howText(b, p.next, l) : b.name[l]}>
              <span className="medal" aria-hidden="true">
                <Icon name={ICON[b.metric]} size={20} />
              </span>
              <b>{b.name[l]}</b>
              <span className="tier">{tier ? TIER[l][tier] : l === "zh" ? "未获得" : "not yet"}</span>
              {p.next !== null && (
                <>
                  <i className="bar" aria-hidden="true">
                    <i style={{ transform: `scaleX(${p.fraction})` }} />
                  </i>
                  <span className="next">{howText(b, p.next, l)}</span>
                </>
              )}
            </li>
          );
        })}
        {/* X2: holder marks for BEM and FAB, shown once a wallet holding them was checked */}
        {(["bem", "fab"] as const)
          .filter((k) => held?.[k])
          .map((k) => (
            <li key={k} className="badge t3 holder-badge" title={k.toUpperCase()}>
              <span className="medal" aria-hidden="true">
                <Icon name="star" size={20} />
              </span>
              <b>{l === "zh" ? `${k.toUpperCase()} 持有人` : `${k.toUpperCase()} holder`}</b>
              <span className="tier">{l === "zh" ? "持有人标记" : "holder mark"}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export function BadgeToast() {
  const { lang } = useLang();
  const l = lang as "en" | "zh";
  const fresh = useBadges((s) => s.fresh);
  const dismiss = useBadges((s) => s.dismiss);
  // a badge earned by teaching a lesson waits while Try it asks about that lesson, then has its full time (B5)
  const offering = useTrial((s) => s.offering);
  // R40: and while a dialog lies over the room, whose dim it was the lightest thing under: it is shown, and said, once
  // the dialog has closed, with its full time from then
  const dialogOpen = useDialogOpen();
  const top = offering || dialogOpen ? undefined : fresh[0];
  useEffect(() => {
    if (!top) return;
    const t = setTimeout(() => dismiss(top.id), 3600);
    return () => clearTimeout(t);
  }, [top, dismiss]);
  // P5: the news is read out from a live region always on the page; the toast is a plain button with its full name
  // (a button given the status role lost its role and its name to screen readers)
  const news = top ? `${l === "zh" ? "新徽章" : "New badge"}: ${top.badge.name[l]} · ${TIER[l][top.tier]}` : "";
  return (
    <>
      <span className="sr-only" role="status">
        {news}
      </span>
      <AnimatePresence>
        {top && (
          <motion.button
            type="button"
            key={top.id}
            className={`badge-toast t${top.tier}`}
            aria-label={`${news}. ${l === "zh" ? "点按关闭" : "Tap to close"}`}
            onClick={() => dismiss(top.id)}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
          >
            <span className="medal" aria-hidden="true">
              <Icon name={ICON[top.badge.metric]} size={22} />
            </span>
            <span>
              <small>{l === "zh" ? "新徽章" : "New badge"}</small>
              <b>
                {top.badge.name[l]} · {TIER[l][top.tier]}
              </b>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
