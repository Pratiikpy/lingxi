/** Bottom sheets and the pet's mind panel. */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { STARTERS } from "@lingxi/brain";
import { DIETS, FOODS, TRAITS, type Pet, dayOf } from "@lingxi/game";
import { useLang, useT } from "../i18n";
import { Icon } from "./icons";
import { Chips } from "./parts";
import { chipsFor, MOOD_NAMES } from "./ruleText";

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} />
          <motion.div
            className="sheet"
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

export function MindPanel({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const p = STARTERS[pet.line];
  let bit = 0;
  const memory = p.memory.map((m) => {
    const bits = m.kind === "flag" ? 1 : m.bits;
    let v = 0;
    for (let b = 0; b < bits; b++) v |= (pet.brain[bit + b] ? 1 : 0) << b;
    bit += bits;
    return { name: m.name, v, max: (1 << bits) - 1, kind: m.kind };
  });
  const memName = (n: string) =>
    ({ trust: { en: "trust", zh: "信任" }, likesToys: { en: "likes toys", zh: "喜欢玩具" }, scared: { en: "shaken", zh: "害怕" }, awake: { en: "awake", zh: "清醒" } })[n]?.[lang] ?? n;
  return (
    <>
      <ul className="rules">
        {p.rules.map((r, i) => {
          const c = chipsFor(p, r, lang);
          return (
            <li key={i} className={pet.last.rule === i ? "fire" : ""}>
              <Chips when={c.when} then={c.then} />
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
      <p className="small">{t("mind.foot")}</p>
    </>
  );
}

export function MeSheetBody({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const top = [...TRAITS].sort((a, b) => pet.traits[b] - pet.traits[a]).slice(0, 2);
  const TRAIT_NAMES: Record<string, { en: string; zh: string }> = {
    brave: { en: "brave", zh: "勇敢" },
    curious: { en: "curious", zh: "好奇" },
    greedy: { en: "greedy", zh: "嘴馋" },
    calm: { en: "calm", zh: "沉稳" },
    playful: { en: "playful", zh: "贪玩" },
    gentle: { en: "gentle", zh: "温柔" },
    shy: { en: "shy", zh: "害羞" },
  };
  const nature = pet.traits[top[0]!] === 0 ? t(`line.${pet.line}`) : top.filter((x) => pet.traits[x] > 0).map((x) => TRAIT_NAMES[x]![lang]).join(lang === "zh" ? "、" : ", ");
  const fav = [...DIETS].sort((a, b) => pet.diet[b] - pet.diet[a])[0]!;
  const favFood = FOODS.find((f) => f.diet === fav);
  const friendship = Math.min(10, Math.floor((pet.counts.pet + pet.counts.feed + pet.counts.play) / 6));
  return (
    <dl className="rows">
      <dt>{t("me.nature")}</dt>
      <dd>{nature}</dd>
      <dt>{t("me.friendship")}</dt>
      <dd>
        <div className="hearts" role="img" aria-label={`${friendship}/10`}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < friendship ? "f" : ""}>
              <Icon name="heart" size={14} />
            </span>
          ))}
        </div>
      </dd>
      <dt>{t("me.together")}</dt>
      <dd>{t("me.days", { n: dayOf(pet, Date.now()) })}</dd>
      <dt>{t("me.diet")}</dt>
      <dd>{pet.diet[fav] > 0 && favFood ? favFood.name[lang] : "–"}</dd>
      <dt>{t("think.label")}</dt>
      <dd>{MOOD_NAMES[lang][pet.last.mood]}</dd>
    </dl>
  );
}
