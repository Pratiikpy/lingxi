/** The pieces of the game screen: top bar, meters, care buttons, thinking strip, tabs. */

import { AnimatePresence, motion } from "motion/react";
import { decidingPart } from "../game/store";
import { type Pet, beatOf, dayOf, kinshipNow, levelOf, stageOf, visibleMeters } from "@lingxi/game";
import { useLang, useT, type Key } from "../i18n";
import { useSound } from "../game/sound";
import type { Daily, Toast } from "../game/store";
import { Icon, type IconName } from "./icons";
import { decidingChips } from "./ruleText";

export function Chips({ when, then }: { when: string[]; then: string }) {
  const { lang } = useLang();
  const and = lang === "zh" ? "且" : "and";
  const so = lang === "zh" ? "就" : "then";
  return (
    <>
      {when.map((w, i) => (
        <span key={`${w}-${i}`} style={{ display: "contents" }}>
          {i > 0 && <span className="op">{and}</span>}
          <span className="chip">{w}</span>
        </span>
      ))}
      <span className="op">{so}</span>
      <span className="chip out">{then}</span>
    </>
  );
}

export function TopBar({ pet, daily, face, onQuests, onPets, petCount }: { pet: Pet; daily: Daily; face: React.ReactNode; onQuests: () => void; onPets: () => void; petCount: number }) {
  const t = useT();
  const toggleLang = useLang((s) => s.toggle);
  const sound = useSound();
  const now = Date.now();
  const done = [daily.fed, daily.played, daily.cleaned, daily.petted];
  const n = done.filter(Boolean).length;
  return (
    <header className="top">
      <div className="who">
        <button type="button" className="who-face who-face-btn" onClick={onPets} aria-label={petCount > 1 ? `${pet.name} · ${petCount}` : pet.name}>
          {face}
          {petCount > 1 && <i className="pet-count">{petCount}</i>}
        </button>
        <div style={{ minWidth: 0 }}>
          <b>{pet.name}</b>
          <span>
            {t(`stage.${stageOf(pet, now)}` as Key)} · {t("who.day", { n: dayOf(pet, now) })} · Lv {levelOf(pet.xp).level}
          </span>
        </div>
      </div>
      <div className="top-right">
        <button type="button" className="pill" onClick={onQuests} aria-label={t("quest.title")}>
          <div className="kin" aria-label={t("me.friendship")}>
            <Icon name="heart" size={16} />
            <span>{kinshipNow(pet, beatOf(now))}</span>
          </div>
          <div className="daily" role="img" aria-label={t("daily.aria", { n })}>
            {done.map((d, i) => (
              <i key={i} className={d ? "on" : ""} />
            ))}
            <small>{t("daily.label")}</small>
          </div>
        </button>
        <button type="button" className="round-btn" onClick={sound.toggle} aria-label={sound.on ? t("sound.on") : t("sound.off")} aria-pressed={sound.on}>
          <Icon name={sound.on ? "sound" : "mute"} size={20} />
        </button>
        <button type="button" className="round-btn" onClick={toggleLang} lang={t("lang") === "EN" ? "en" : "zh-CN"}>
          {t("lang")}
        </button>
      </div>
    </header>
  );
}

const METER_KEYS = [
  ["food", "meter.food", "m-food"],
  ["joy", "meter.joy", "m-joy"],
  ["energy", "meter.energy", "m-energy"],
  ["clean", "meter.clean", "m-clean"],
] as const;

export function Meters({ pet }: { pet: Pet }) {
  const t = useT();
  const m = visibleMeters(pet);
  return (
    <div className="meters">
      {METER_KEYS.map(([k, label, cls]) => {
        const v = m[k];
        const low = v < 300;
        return (
          <div key={k} className={`meter ${cls}${low ? " low" : ""}`}>
            <div className="meter-head">
              {t(label)} <span>{low ? t("meter.low") : Math.round(v / 10)}</span>
            </div>
            <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={1000} aria-valuenow={v} aria-label={t(label)}>
              <b style={{ transform: `scaleX(${v / 1000})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Actions({ pet, onFeed, onPlay, onClean, onSleep, onMedicine }: { pet: Pet; onFeed: () => void; onPlay: () => void; onClean: () => void; onSleep: () => void; onMedicine: () => void }) {
  const t = useT();
  const m = visibleMeters(pet);
  const btn = (icon: IconName, label: string, on: () => void, hint: boolean, disabled = false) => (
    <button type="button" className={`act${hint ? " hint" : ""}`} onClick={on} disabled={disabled}>
      <Icon name={icon} size={24} />
      {label}
    </button>
  );
  return (
    <div className="actions">
      {btn("bowl", t("act.feed"), onFeed, m.food < 350 && !pet.asleep)}
      {pet.sick ? btn("pill", t("act.medicine"), onMedicine, true) : btn("ball", t("act.play"), onPlay, false, pet.asleep)}
      {btn("sparkle", t("act.clean"), onClean, m.clean < 250 && !pet.asleep, pet.asleep)}
      {btn(pet.asleep ? "sun" : "moon", pet.asleep ? t("act.wake") : t("act.sleep"), onSleep, m.energy < 250 && !pet.asleep)}
    </div>
  );
}

export function ThinkStrip({ pet }: { pet: Pet }) {
  const t = useT();
  const { lang } = useLang();
  const c = decidingChips(decidingPart(pet).program, pet.last.rule, lang);
  return (
    <div className="think" aria-live="off">
      <em>{t("think.label")}</em>
      <Chips when={c.when} then={c.then} />
    </div>
  );
}

export function ToastView({ toast, name }: { toast: Toast | null; name: string }) {
  const t = useT();
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className="toast"
          role="status"
          initial={{ opacity: 0, y: -12, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          exit={{ opacity: 0, y: -8, x: "-50%" }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {t(`note.${toast.note}` as Key, { name })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type Tab = "home" | "map" | "bag" | "mind" | "spar" | "me" | "quests" | "pets" | "games";
const TABS: ReadonlyArray<[Tab, IconName, Key]> = [
  ["home", "home", "tab.home"],
  ["map", "map", "tab.map"],
  ["bag", "bag", "tab.bag"],
  ["mind", "mind", "tab.mind"],
  ["spar", "paw", "tab.spar"],
  ["me", "pet", "tab.me"],
];

export function TabBar({ current, onPick }: { current: Tab; onPick: (t: Tab) => void }) {
  const t = useT();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(([id, icon, label]) => (
        <button key={id} type="button" className="tab" aria-current={current === id ? "page" : undefined} onClick={() => onPick(id)}>
          <Icon name={icon} size={22} />
          {t(label)}
        </button>
      ))}
    </nav>
  );
}
