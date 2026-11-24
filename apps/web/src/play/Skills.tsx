/**
 * Levels and the four skill trees (plan 4.4). The skills screen: the pet's level and points, a tab per tree, the
 * six tiers by three with their gates read from the same table the rules use, the chosen skill's details with the
 * reason when it cannot be taken, and the Fresh Start Tea that returns every point. Also the level-up moment.
 */

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { create } from "zustand";
import {
  type Growth,
  SKILLS,
  SKILL_BY_ID,
  type SkillDef,
  type Tree,
  TREES,
  canLevelUp,
  growthOf,
  levelCost,
  tierNeed,
  tierOpen,
  treePoints,
  upgradeRefusal,
} from "@lingxi/game";
import { ITEM } from "@lingxi/world";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { useGame } from "../game/store";
import { useWorld } from "../game/world";
import "./skills.css";

type Lang = "en" | "zh";
/** The Fresh Start Tea (respec) in the bag. */
export const FRESH_START_TEA = 11403;

const TREE_NAME: Record<Tree, [string, string]> = {
  care: ["Care", "照顾"],
  mind: ["Mind", "心智"],
  explore: ["Explore", "探索"],
  spar: ["Spar", "切磋"],
};
const TREE_SAYS: Record<Tree, [string, string]> = {
  care: [
    "How it lives: slower needs, deeper sleep, more from food and play.",
    "它怎么过日子：需求变慢、睡得更香、吃和玩收获更多。",
  ],
  mind: [
    "How it thinks: more lessons, room for more gates, rules of its own.",
    "它怎么思考：装更多课、给更多门留空间、长出自己的规则。",
  ],
  explore: ["How it explores: cheaper walks, more and rarer finds.", "它怎么探索：走路更省力，找到的更多、更稀有。"],
  spar: [
    "How it spars: power, health, stamina, guard and dodge, and the prize.",
    "它怎么切磋：力量、体力、耐力、防守、闪避，还有奖金。",
  ],
};

/** The skills sheet is opened from the level chip, the level-up moment, the Pet sheet and the bag's Fresh Start Tea. */
export const useSkillsUi = create<{
  open: boolean;
  respec: boolean;
  show: (o?: { respec?: boolean }) => void;
  hide: () => void;
  celebrate: number | null;
  setCelebrate: (level: number | null) => void;
}>((set) => ({
  open: false,
  respec: false,
  show: (o) => set({ open: true, respec: !!o?.respec }),
  hide: () => set({ open: false, respec: false }),
  celebrate: null,
  setCelebrate: (celebrate) => set({ celebrate }),
}));

/** Spend XP for the next level, with the celebration. */
export function levelUpNow(): void {
  const r = useGame.getState().levelUp();
  if (!r.ok) return play("error");
  play("sparkle");
  useSkillsUi.getState().setCelebrate(r.level);
}

function refusalText(g: Growth, s: SkillDef, lang: Lang): string | null {
  const no = upgradeRefusal(g, s.id);
  if (!no) return null;
  const zh = lang === "zh";
  const tree = TREE_NAME[s.tree][zh ? 1 : 0];
  switch (no.reason) {
    case "maxed":
      return zh ? "已经学满了。" : "Learned in full.";
    case "tier":
      return zh
        ? `${tree}树里要先有 ${no.need} 点（现在 ${no.have}）。`
        : `Needs ${no.need} points in the ${tree} tree first (now ${no.have}).`;
    case "excluded":
      return zh
        ? `和「${SKILL_BY_ID[no.by!]!.name.zh}」二选一，已经选了那个。`
        : `One or the other with ${SKILL_BY_ID[no.by!]!.name.en}, which it already has.`;
    case "points":
      return zh ? "没有技能点了。升级就会得到一点。" : "No skill points left. Each level gives one.";
    default:
      return zh ? "不能学。" : "Can't be learned.";
  }
}

function Node({ s, g, picked, onPick }: { s: SkillDef; g: Growth; picked: boolean; onPick: () => void }) {
  const lang = useLang((x) => x.lang) as Lang;
  const have = g.skills[s.id] ?? 0;
  const no = upgradeRefusal(g, s.id);
  const state =
    have >= s.max
      ? "full"
      : no?.reason === "tier"
        ? "locked"
        : no?.reason === "excluded"
          ? "excluded"
          : have > 0
            ? "some"
            : no?.reason === "points"
              ? "waiting"
              : "open";
  return (
    <button
      type="button"
      className={`sk-node sk-${state}${s.max === 1 ? " sk-cap" : ""}${picked ? " picked" : ""}`}
      aria-pressed={picked}
      aria-label={`${s.name[lang]} ${have}/${s.max}`}
      onClick={() => (play("tap"), onPick())}
    >
      <span className="sk-ring" style={{ ["--fill" as string]: `${(have / s.max) * 360}deg` }} aria-hidden="true">
        <b>{s.max === 1 ? (have ? "★" : state === "excluded" ? "✕" : "☆") : have}</b>
      </span>
      <span className="sk-name">{s.name[lang]}</span>
    </button>
  );
}

export function SkillsPanel() {
  const lang = useLang((x) => x.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const pet = useGame((x) => x.pet);
  const learn = useGame((x) => x.learnSkill);
  const respec = useGame((x) => x.respec);
  const bag = useWorld((x) => x.world.bag);
  const { respec: askRespec, show } = useSkillsUi();
  const [tree, setTree] = useState<Tree>("care");
  const [pick, setPick] = useState<number>(111);
  const [confirm, setConfirm] = useState(askRespec);
  if (!pet) return null;
  const g = growthOf(pet);
  const s = SKILL_BY_ID[pick]!;
  const reason = refusalText(g, s, lang);
  const spent = Object.values(g.skills).reduce((a, b) => a + b, 0);
  const teas = bag[FRESH_START_TEA] ?? 0;
  const need = levelCost(g.level);
  const ready = canLevelUp(g, pet.xp);
  return (
    <div className="skills">
      <div className="sk-head">
        <div className="sk-level">
          <b>{L(`Level ${g.level}`, `${g.level} 级`)}</b>
          <span
            className="sk-xp"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={need}
            aria-valuenow={Math.min(need, pet.xp)}
            aria-label={L("Experience to the next level", "距下一级的经验")}
          >
            <i style={{ transform: `scaleX(${Math.min(1, pet.xp / need)})` }} />
          </span>
          <span className="small">
            {ready
              ? L("Ready to level up!", "可以升级了！")
              : L(`${pet.xp} / ${need} XP to level ${g.level + 1}`, `${pet.xp} / ${need} 经验升到 ${g.level + 1} 级`)}
          </span>
        </div>
        <div className="sk-points">
          <b>{g.points}</b>
          <span>{L(g.points === 1 ? "point to spend" : "points to spend", "个技能点可用")}</span>
        </div>
        {ready && (
          <button type="button" className="btn primary sk-up" onClick={levelUpNow}>
            {L("Level up", "升级")}
          </button>
        )}
      </div>

      <div className="sk-tabs" role="tablist">
        {TREES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tree === t}
            className={`sk-tab sk-t-${t}${tree === t ? " on" : ""}`}
            onClick={() => (play("tap"), setTree(t), setPick(SKILLS.find((x) => x.tree === t && x.tier === 1)!.id))}
          >
            {TREE_NAME[t][lang === "zh" ? 1 : 0]}
            <small>{treePoints(g, t)}</small>
          </button>
        ))}
      </div>
      <p className="small sk-says">{TREE_SAYS[tree][lang === "zh" ? 1 : 0]}</p>

      <ol className={`sk-grid sk-t-${tree}`}>
        {[1, 2, 3, 4, 5, 6].map((tier) => {
          const open = tierOpen(g, tree, tier);
          return (
            <li key={tier} className={`sk-row${open ? "" : " closed"}${tier === 3 || tier === 6 ? " caps" : ""}`}>
              <span className="sk-tier">
                {tier}
                {!open && <small>{L(`${tierNeed(tier)} pts`, `${tierNeed(tier)} 点`)}</small>}
              </span>
              {SKILLS.filter((x) => x.tree === tree && x.tier === tier).map((x) => (
                <Node key={x.id} s={x} g={g} picked={pick === x.id} onPick={() => setPick(x.id)} />
              ))}
            </li>
          );
        })}
      </ol>

      <section className="sk-detail" aria-live="polite">
        <div className="sk-detail-head">
          <b>{s.name[lang]}</b>
          <span className="sk-count">
            {g.skills[s.id] ?? 0}/{s.max}
          </span>
        </div>
        <p>{s.desc[lang]}</p>
        {s.max === 1 && (
          <p className="small sk-note">
            {L("A capstone: only one of the three in this row.", "顶级技能：这一排三个只能选一个。")}
          </p>
        )}
        {s.rule && (
          <p className="small sk-note">
            {L(
              "It joins the pet's circuit; save its brain on X Layer and the chain carries it too.",
              "它会加进宠物的电路；在 X Layer 上保存大脑，链上也会带着它。",
            )}
          </p>
        )}
        {reason ? (
          <p className="small sk-why">{reason}</p>
        ) : (
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const r = learn(s.id);
              play(r.ok ? "success" : "error");
            }}
          >
            {L("Learn it (1 point)", "学习（1 点）")}
          </button>
        )}
      </section>

      <section className="sk-respec">
        <div>
          <b>{ITEM[FRESH_START_TEA]?.name[lang]}</b>
          <span className="small">
            {teas
              ? L(
                  `${teas} in the bag. Drinking one forgets every skill; all ${spent} points come back.`,
                  `包里有 ${teas} 杯。喝一杯就会忘掉所有技能，${spent} 点全部回来。`,
                )
              : L(
                  "Brew one at the workbench (an old bottle and mint leaves) to choose again.",
                  "在工作台泡一杯（旧瓶子加薄荷叶），就能重新选择。",
                )}
          </span>
        </div>
        {teas > 0 && spent > 0 && !confirm && (
          <button type="button" className="btn" onClick={() => (play("tap"), setConfirm(true))}>
            {L("Drink it", "喝下去")}
          </button>
        )}
        {confirm && teas > 0 && spent > 0 && (
          <div className="sk-confirm" role="alertdialog" aria-label={L("Forget every skill?", "忘掉所有技能？")}>
            <span>
              {L(`Forget every skill? All ${spent} points come back.`, `忘掉所有技能？${spent} 点全部回来。`)}
            </span>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (!useWorld.getState().consume(FRESH_START_TEA)) return play("error");
                respec();
                play("sparkle");
                setConfirm(false);
                show();
              }}
            >
              {L("Yes, choose again", "好，重新选")}
            </button>
            <button type="button" className="btn ghost" onClick={() => (play("tap"), setConfirm(false))}>
              {L("Keep them", "先不了")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/** The level-up moment: the new level, the point it brings, and the way to spend it. */
export function LevelUpMoment() {
  const lang = useLang((x) => x.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const reduce = useReducedMotion() ?? false;
  const { celebrate, setCelebrate, show } = useSkillsUi();
  const pet = useGame((x) => x.pet);
  return (
    <AnimatePresence>
      {celebrate !== null && pet && (
        <motion.div
          className="fam-modal sk-moment"
          role="dialog"
          aria-modal="true"
          aria-label={L(`Level ${celebrate}`, `${celebrate} 级`)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="fam-card sk-moment-card"
            initial={reduce ? { opacity: 0 } : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <div className="sk-burst" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} style={{ ["--a" as string]: `${i * 36}deg` }} />
              ))}
            </div>
            <p className="sk-moment-level">{L(`Level ${celebrate}!`, `${celebrate} 级！`)}</p>
            <p>{L(`${pet.name} grew. One skill point to spend.`, `${pet.name}长大了一点。多了 1 个技能点。`)}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => (play("tap"), setCelebrate(null), show())}>
                {L("Choose a skill", "选一个技能")}
              </button>
              <button type="button" className="btn" onClick={() => (play("tap"), setCelebrate(null))}>
                {L("Later", "等会儿")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
