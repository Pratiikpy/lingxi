/** Bottom sheets and the pet's mind panel. */

import { useEffect, useMemo, useRef } from "react";
import { type Palette, ROLES, drawPet } from "@lingxi/art";
import { PALETTE_OF } from "../scene/palette";
import { Sprite } from "./Sprite";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type MindPart, mindParts } from "../game/store";
import {
  DIETS,
  FOODS,
  FORMS,
  FORM_NAMES,
  TRAIT_NAMES,
  type Pet,
  beatOf,
  dayOf,
  evolutionInputs,
  evolve,
  growthOf,
  instinctsOf,
  kinshipNow,
  levelCost,
  natureOf,
  stageOf,
} from "@lingxi/game";
import { useSkillsUi } from "./Skills";
import { useLang, useT, type Key } from "../i18n";
import { Icon } from "./icons";
import { Chips } from "./parts";
import { chipsFor, MOOD_NAMES } from "./ruleText";
import { now as gameNow } from "../game/gameClock";
import { onBack } from "../game/backStack";

/** Open sheets, newest last: Escape closes only the one on top when two are stacked. */
const openSheets: object[] = [];

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  // the latest close, for the back button: the sheet registers once per opening, not on every render (P6)
  const closeLatest = useRef(onClose);
  useEffect(() => {
    closeLatest.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    return onBack(() => closeLatest.current());
  }, [open]);
  // how many sheets were already open when this one opened: it is drawn above them, whatever their order on the page
  // (a sheet earlier on the page, such as the skills, opened from a later one, such as the pet's, sat beneath it, A124)
  const depth = useMemo(() => (open ? openSheets.length : 0), [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const me = {};
    openSheets.push(me);
    // Tab stays inside the sheet on top through the game's dialog focus (modalFocus.ts, P5)
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && openSheets[openSheets.length - 1] === me && closeLatest.current();
    window.addEventListener("keydown", onKey);
    return () => {
      openSheets.splice(openSheets.indexOf(me), 1);
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // once per opening: the focus is taken when the sheet opens and given back when it closes, never in between (R8)
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="scrim"
            style={depth ? { zIndex: 20 + 2 * depth } : undefined}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          />
          <motion.div
            className="sheet"
            style={depth ? { zIndex: 21 + 2 * depth } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduce ? { opacity: 0 } : { y: "105%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "105%" }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="grab" aria-hidden="true" />
            <div className="shead">
              <h2 className="h2">{title}</h2>
              <button ref={closeRef} type="button" className="round-btn" onClick={onClose} aria-label={t("close")}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="sbody">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function FoodList({ pet, onPick }: { pet: Pet; onPick: (id: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <>
      <div className="foods">
        {FOODS.map((f) => (
          <button key={f.id} type="button" className="food" onClick={() => onPick(f.id)}>
            <img className="pixel" src={f.art} alt="" width={48} height={48} />
            <div style={{ minWidth: 0 }}>
              <b>{f.name[lang]}</b>
              <span>
                +{Math.round(f.food / 10)} {t("meter.food")}
                {f.joy > 0 ? ` · +${Math.round(f.joy / 10)} ${t("meter.joy")}` : ""}
              </span>
            </div>
          </button>
        ))}
      </div>
      <p className="small">{t("care.note", { name: pet.name })}</p>
    </>
  );
}

/** R52: the ids MindPanel gives its lists of rules under `prefix`, one a part, for a region described by them. */
export const mindListIds = (pet: Pet, prefix: string): string[] => mindParts(pet).map((_, i) => `${prefix}-${i}`);

/** A pet's mind: its rules and memory. `listIds` names its lists of rules (only where one copy is on the page: R52). */
export function MindPanel({ pet, listIds }: { pet: Pet; listIds?: string }) {
  const t = useT();
  const parts = mindParts(pet);
  return (
    <>
      {parts.map((part, idx) => (
        <MindPartView
          key={idx}
          pet={pet}
          part={part}
          firing={parts.length === 1 || pet.last.half === idx}
          {...(listIds ? { listId: `${listIds}-${idx}` } : {})}
        />
      ))}
      <p className="small">{t("mind.foot")}</p>
    </>
  );
}

function MindPartView({ pet, part, firing, listId }: { pet: Pet; part: MindPart; firing: boolean; listId?: string }) {
  const t = useT();
  const { lang } = useLang();
  const p = part.program;
  // each memory sits after the ones before it, from the part's own offset
  const widths = p.memory.map((m) => (m.kind === "flag" ? 1 : m.bits));
  const memory = p.memory.map((m, i) => {
    const bits = widths[i]!;
    const start = part.offset + widths.slice(0, i).reduce((a, w) => a + w, 0);
    let v = 0;
    for (let b = 0; b < bits; b++) v |= (pet.brain[start + b] ? 1 : 0) << b;
    return { name: m.name, v, max: (1 << bits) - 1, kind: m.kind };
  });
  const memName = (n: string) =>
    ({
      trust: { en: "trust", zh: "信任" },
      likesToys: { en: "likes toys", zh: "喜欢玩具" },
      scared: { en: "shaken", zh: "害怕" },
      awake: { en: "awake", zh: "清醒" },
    })[n]?.[lang] ?? n;
  return (
    <>
      {part.from && (
        <p className="half-head">
          {part.from.when === "day"
            ? lang === "zh"
              ? `白天和心情：像${part.from.name}`
              : `By day, and its moods: like ${part.from.name}`
            : lang === "zh"
              ? `夜里和小习惯：像${part.from.name}`
              : `By night, and its habits: like ${part.from.name}`}
        </p>
      )}
      <ul className="rules" id={listId}>
        {p.rules.map((r, i) => {
          const c = chipsFor(p, r, lang);
          return (
            <li key={i} className={firing && pet.last.rule === i ? "fire" : ""}>
              {r.label?.startsWith("instinct: ") && (
                <span className="instinct-tag" aria-hidden="true">
                  {t("mind.instinct")}
                </span>
              )}
              <Chips
                when={c.when}
                then={c.then}
                want={c.want}
                {...(r.label?.startsWith("instinct: ") ? { lead: t("mind.instinct") } : {})}
              />
            </li>
          );
        })}
      </ul>
      <div>
        <p className="small" style={{ marginBottom: 6 }}>
          {t("mind.memory")}
        </p>
        <div className="memory">
          {memory.map((m) => (
            <span key={m.name} className="mem">
              {memName(m.name)} <b>{m.kind === "flag" ? (m.v ? "✓" : "–") : `${m.v}/${m.max}`}</b>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

export function MeSheetBody({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  // R64: its nature is its egg's line; what drifts with what it does is its habits, a leaning until one forms
  const nature = natureOf(pet);
  const habits = nature.habits.length
    ? nature.habits.map((x) => TRAIT_NAMES[x][lang]).join(lang === "zh" ? "、" : ", ")
    : nature.growing
      ? t("me.habitGrowing", { trait: TRAIT_NAMES[nature.growing][lang] })
      : t("me.habitsNone");
  const fav = [...DIETS].sort((a, b) => pet.diet[b] - pet.diet[a])[0]!;
  const favFood = FOODS.find((f) => f.diet === fav);
  const kin = kinshipNow(pet, beatOf(gameNow()));
  const friendship = Math.min(10, kin);
  // the level is kept and XP is spent at each level-up (plan 4.4): the bar shows the way to the next
  const g = growthOf(pet);
  const lv = { level: g.level, into: Math.min(pet.xp, levelCost(g.level)), need: levelCost(g.level) };
  const MISS: Record<string, [string, string]> = {
    food: ["got very hungry", "饿坏了"],
    joy: ["felt lonely", "觉得孤单"],
    clean: ["got very dirty", "脏兮兮的"],
    energy: ["ran out of energy", "累坏了"],
    sick: ["fell ill", "生病了"],
  };
  const ago = (beat: number) => {
    const h = Math.max(0, Math.round((beatOf(gameNow()) - beat) / 60));
    return h < 1
      ? lang === "zh"
        ? "刚才"
        : "just now"
      : h < 48
        ? lang === "zh"
          ? `${h} 小时前`
          : `${h} h ago`
        : lang === "zh"
          ? `${Math.round(h / 24)} 天前`
          : `${Math.round(h / 24)} days ago`;
  };
  return (
    <dl className="rows">
      <dt>{t("me.nature")}</dt>
      <dd>{t(`line.${nature.line}`)}</dd>
      <dt>{t("me.habits")}</dt>
      <dd className={nature.habits.length ? undefined : "me-quiet"}>{habits}</dd>
      <dt>{t("hatch.instincts")}</dt>
      <dd>
        {instinctsOf(pet.instincts)
          .map((k) => t(`instinct.${k}` as Key))
          .join(lang === "zh" ? "、" : ", ") || t("me.noInstincts")}
      </dd>
      <dt>{lang === "zh" ? "等级" : "Level"}</dt>
      <dd>
        <span className="lv">
          {lang === "zh" ? `${lv.level} 级` : `Lv ${lv.level}`}
          <i
            className="lv-bar"
            role="meter"
            aria-label={lang === "zh" ? "到下一级" : "To the next level"}
            aria-valuemin={0}
            aria-valuemax={lv.need}
            aria-valuenow={lv.into}
            aria-valuetext={lang === "zh" ? `${lv.into}/${lv.need}` : `${lv.into} of ${lv.need}`}
          >
            <i style={{ transform: `scaleX(${lv.into / lv.need})` }} />
          </i>
          <button type="button" className="btn small-btn lv-skills" onClick={() => useSkillsUi.getState().show()}>
            {lang === "zh"
              ? `技能${g.points ? ` · ${g.points} 点可用` : ""}`
              : `Skills${g.points ? ` · ${g.points} to spend` : ""}`}
          </button>
        </span>
      </dd>
      {/* R30: the word sits level with its hearts, not between them and the note under them */}
      <dt className="kin-dt">{t("me.friendship")}</dt>
      <dd className="kin-dd">
        <div className="hearts" role="img" aria-label={lang === "zh" ? `亲密度 ${kin}` : `Friendship ${kin}`}>
          {/* R30: every heart has its edge, so one not yet earned still reads as a heart; an earned one is filled */}
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < friendship ? "f" : ""}>
              {i < friendship && <Icon name="heart" size={14} className="heart-fill" />}
              <Icon name="heart-line" size={14} className="heart-edge" />
            </span>
          ))}
        </div>
        {kin > 10 ? ` ${kin}` : ""}
        {/* its own line under the hearts, so it never starts with a stray "·" (B7) */}
        <span className="small kin-note">
          {lang === "zh"
            ? "每 12 小时摸一次 +1，一整天不摸会慢慢变淡"
            : "+1 for a pat every 12 hours; fades after a day without"}
        </span>
      </dd>
      {pet.sick && (
        <>
          <dt>{lang === "zh" ? "身体" : "Health"}</dt>
          <dd className="warn">{lang === "zh" ? "生病了，给它吃点药吧" : "Ill. A dose of medicine will help."}</dd>
        </>
      )}
      {(pet.missed?.length ?? 0) > 0 && (
        <>
          <dt>{lang === "zh" ? "照顾小记" : "Care notes"}</dt>
          <dd>
            <ul className="care-notes">
              {pet
                .missed!.slice(-4)
                .reverse()
                .map((m, i) => (
                  <li key={i}>
                    {lang === "zh" ? `${pet.name}${MISS[m.kind]![1]}` : `${pet.name} ${MISS[m.kind]![0]}`}{" "}
                    <span className="small">· {ago(m.beat)}</span>
                  </li>
                ))}
            </ul>
            <span className="small">
              {lang === "zh" ? "没关系，宠物不会因此离开你。" : "No harm done: pets never leave over this."}
            </span>
          </dd>
        </>
      )}
      <dt>{t("me.together")}</dt>
      <dd>{dayOf(pet, gameNow()) === 1 ? t("me.day1") : t("me.days", { n: dayOf(pet, gameNow()) })}</dd>
      <dt>{t("me.diet")}</dt>
      <dd>{pet.diet[fav] > 0 && favFood ? favFood.name[lang] : "–"}</dd>
      <dt>{t("think.label")}</dt>
      <dd>{MOOD_NAMES[lang][pet.last.mood]}</dd>
    </dl>
  );
}

/** Every colour of a secret form painted one soft lavender, so only its outline shows. */
const SILHOUETTE = Object.fromEntries(
  ROLES.filter((r) => r !== ".").map((r) => [r, r === "s" ? "#2B214022" : "#CFC6DA"]),
) as Palette;

/** A form's adult body, or its silhouette while it is still a secret. */
function FormSprite({ line, form, shown }: { line: Pet["line"]; form: (typeof FORMS)[number]; shown: boolean }) {
  const art = useMemo(
    () => drawPet(line, "adult", { form, expression: shown ? "happy" : "neutral" }),
    [line, form, shown],
  );
  const palette = useMemo(() => (shown ? PALETTE_OF[line] : SILHOUETTE), [line, shown]);
  return (
    <span className="evo-art" aria-hidden="true">
      <Sprite canvas={art} palette={palette} scale={1.5} />
    </span>
  );
}

export function EvolutionChart({ pet }: { pet: Pet }) {
  const { lang } = useLang();
  const now = gameNow();
  const grown = ["adult", "elder"].includes(stageOf(pet, now));
  // once grown the form is fixed; before that, the chart shows where today's care is heading
  const e = pet.form ? { form: pet.form } : evolve(evolutionInputs(pet, now));
  return (
    <div className="evo">
      <p className="small">
        {grown
          ? lang === "zh"
            ? `${pet.name}长成了「${FORM_NAMES[e.form].zh}」。`
            : `${pet.name} grew into a ${FORM_NAMES[e.form].en}.`
          : lang === "zh"
            ? `照现在这样，${pet.name}会长成「${FORM_NAMES[e.form].zh}」。到第 8 天揭晓。`
            : `Raised like this, ${pet.name} will grow into a ${FORM_NAMES[e.form].en}. Revealed on day 8.`}
      </p>
      <ul className="evo-list">
        {FORMS.map((f) => (
          <li key={f} className={f === e.form ? "on" : ""}>
            <FormSprite line={pet.line} form={f} shown={grown || f === e.form} />
            <b>{grown || f === e.form ? FORM_NAMES[f][lang] : "???"}</b>
            <span>{FORM_NAMES[f].how[lang]}</span>
          </li>
        ))}
      </ul>
      <p className="small">
        {lang === "zh"
          ? "这张进化表本身就是一个公开电路，谁都能验证。"
          : "This chart is itself a public circuit anyone can verify."}
      </p>
    </div>
  );
}
