/** The pieces of the game screen: top bar, meters, care buttons, thinking strip, tabs. */

import { isOpen, useReveal } from "../game/reveal";
import { type ReactNode, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useVoice } from "../game/voice";
import { decidingPart, mindForPet } from "../game/store";
import { useQuestStatuses } from "../game/quests";
import { useWorld } from "../game/world";
import { useBadges } from "../game/badges";
import { useAlbum } from "./Album";
import {
  CHARACTERS,
  DECOR,
  ITEM,
  QUESTLINE,
  ROOMS,
  giftAtDoor,
  happeningAt,
  happeningUsed,
  marketPrice,
  villageEvening,
} from "@lingxi/world";
import {
  BADGES,
  ENJOY_MAX,
  ENJOY_PER_CARE,
  HABIT_REST,
  type Pet,
  VISITORS,
  strongestHabit,
  tierOf,
  beatOf,
  dayChoices,
  nextWorldSeason,
  rewind,
  worldSeasonAt,
  canLevelUp,
  dayOf,
  growthOf,
  kinshipNow,
  stageOf,
  visibleMeters,
} from "@lingxi/game";
import { levelUpNow, useSkillsUi } from "./Skills";
import { useLang, useT, type Key } from "../i18n";
import { play, useSound } from "../game/sound";
import type { Daily, Toast } from "../game/store";
import { Icon, type IconName } from "./icons";
import { WANT_COLORS, decidingChips, WANT_NAMES } from "./ruleText";
import { ruleKindOf } from "../game/ruleKind";
import { PetName } from "./PetName";
import { recordOf } from "../game/chain";
import { now as gameNow } from "../game/gameClock";

export function Chips({ when, then, want }: { when: string[]; then: string; want?: number }) {
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
      <span className="chip out" style={want !== undefined ? { background: WANT_COLORS[want] } : undefined}>
        {then}
      </span>
    </>
  );
}

/** Today's four cares, in the order of the header's marks. */
const DAILY_ICONS = ["bowl", "ball", "sparkle", "hand"] as const;

export function TopBar({
  pet,
  daily,
  face,
  onQuests,
  onPets,
  petCount,
  onMail,
  unread = 0,
}: {
  pet: Pet;
  daily: Daily;
  face: React.ReactNode;
  onQuests: () => void;
  onPets: () => void;
  petCount: number;
  onMail: () => void;
  unread?: number;
}) {
  const t = useT();
  const toggleLang = useLang((s) => s.toggle);
  const sound = useSound();
  const now = gameNow();
  const done = [daily.fed, daily.played, daily.cleaned, daily.petted];
  const n = done.filter(Boolean).length;
  return (
    <header className="top">
      <div className="who">
        <div className="who-face-wrap">
          <button
            type="button"
            className="who-face who-face-btn"
            onClick={onPets}
            aria-label={petCount > 1 ? `${pet.name} · ${petCount}` : pet.name}
          >
            {face}
            {petCount > 1 && <i className="pet-count">{petCount}</i>}
          </button>
          {/* the level (plan 4.4), on the avatar: opens the skills; when XP is enough, a tap levels up */}
          <LevelBadge pet={pet} />
        </div>
        <div style={{ minWidth: 0 }}>
          {/* P5: the room's one level-one heading is the pet's name, its title on screen too */}
          <h1 className="who-title">
            <PetName name={pet.name} petId={recordOf(pet)?.petId} />
          </h1>
          {/* on a narrow phone only the day shows (B9: the line was cut off); the stage is still read out and on the Pet tab */}
          <span aria-label={`${t(`stage.${stageOf(pet, now)}` as Key)} · ${t("who.day", { n: dayOf(pet, now) })}`}>
            <i className="who-stage">{t(`stage.${stageOf(pet, now)}` as Key)} · </i>
            {t("who.day", { n: dayOf(pet, now) })}
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
            {/* each mark is the care it stands for (B6): fed, played with, bathed, patted */}
            {done.map((d, i) => (
              <i key={i} className={d ? "on" : ""}>
                <Icon name={DAILY_ICONS[i]!} size={12} />
              </i>
            ))}
            <small>{t("daily.label")}</small>
          </div>
        </button>
        <button
          type="button"
          className="round-btn mail-btn"
          onClick={onMail}
          aria-label={
            unread
              ? t("lang") === "EN"
                ? `邮件，${unread} 封未读`
                : `Mail, ${unread} unread`
              : t("lang") === "EN"
                ? "邮件"
                : "Mail"
          }
        >
          <Icon name="mail" size={20} />
          {unread > 0 && <i className="mail-badge">{unread}</i>}
        </button>
        <button
          type="button"
          className="round-btn"
          onClick={sound.toggle}
          aria-label={sound.on ? t("sound.on") : t("sound.off")}
          aria-pressed={sound.on}
        >
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
            <div
              className="bar"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={1000}
              aria-valuenow={v}
              aria-label={t(label)}
            >
              <b style={{ transform: `scaleX(${v / 1000})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Actions({
  pet,
  absent = false,
  onFeed,
  onPlay,
  onClean,
  onSleep,
  onMedicine,
  onToday,
  onCollection,
}: {
  pet: Pet;
  absent?: boolean;
  onFeed: () => void;
  onPlay: () => void;
  onClean: () => void;
  onSleep: () => void;
  onMedicine: () => void;
  onToday?: () => void;
  onCollection?: () => void;
}) {
  const t = useT();
  const m = visibleMeters(pet);
  // a pet staying with a friend is cared for there, and a pet on a trip is not home
  const away = !!pet.away || absent;
  const btn = (icon: IconName, label: string, on: () => void, hint: boolean, disabled = false, id?: string) => (
    <button
      type="button"
      className={`act${hint && !away ? " hint" : ""}`}
      onClick={on}
      disabled={disabled || away}
      data-hint={id}
    >
      <Icon name={icon} size={24} />
      {label}
    </button>
  );
  return (
    <div className="actions">
      {btn("bowl", t("act.feed"), onFeed, m.food < 350 && !pet.asleep, false, "feed")}
      {pet.sick
        ? btn("pill", t("act.medicine"), onMedicine, true, false, "medicine")
        : btn("ball", t("act.play"), onPlay, false, pet.asleep, "play")}
      {btn("sparkle", t("act.clean"), onClean, m.clean < 250 && !pet.asleep, pet.asleep, "clean")}
      {btn(
        pet.asleep ? "sun" : "moon",
        pet.asleep ? t("act.wake") : t("act.sleep"),
        onSleep,
        m.energy < 250 && !pet.asleep,
        false,
        "sleep",
      )}
      <EnjoyBar pet={pet} />
      {onToday && onCollection && <TodayCard onToday={onToday} onCollection={onCollection} />}
      <TodayChoices pet={pet} />
      <VillageLine pet={pet} />
      <SeasonLine />
    </div>
  );
}

/**
 * G10: the first screen says what there is to do today and how much has been collected (after Chipet's home page): how
 * many of today's errands are done and the next one, and one count of visitors met, badges earned and home pieces
 * owned. Each opens where it lives.
 */
function TodayCard({ onToday, onCollection }: { onToday: () => void; onCollection: () => void }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const today = useWorld((s) => s.world.quests?.today);
  const owned = useWorld((s) => s.world.decor?.owned.length ?? 0);
  const album = useAlbum((s) => s.album);
  const ledger = useBadges((s) => s.ledger);
  const statuses = useQuestStatuses();
  const offered = today?.offered ?? [];
  const done = today ? today.done.length : 0;
  // D4: one whose count is reached waits to be handed in; it is named first, and said to be ready
  const open = offered.map((id) => QUESTLINE.find((q) => q.id === id)).filter((q) => q && !today!.done.includes(q.id));
  const ready = open.find((q) => statuses[q!.id] === "ready");
  const next = ready ?? open[0];
  const met = VISITORS.filter((v) => album[v.id]).length;
  const badges = BADGES.filter((b) => tierOf(b, ledger) > 0).length;
  const pieces = DECOR.length;
  const have = met + badges + owned;
  const all = VISITORS.length + BADGES.length + pieces;
  const parts = zh
    ? `访客 ${met}/${VISITORS.length}、徽章 ${badges}/${BADGES.length}、家具 ${owned}/${pieces}`
    : `visitors ${met}/${VISITORS.length}, badges ${badges}/${BADGES.length}, home pieces ${owned}/${pieces}`;
  return (
    <div className="today-card">
      <button type="button" className="tcard-errands" onClick={() => (play("tap"), onToday())}>
        <b>{zh ? `今天 ${done}/${offered.length || 3}` : `Today ${done}/${offered.length || 3}`}</b>
        <span className={ready ? "tcard-ready" : undefined}>
          {ready
            ? zh
              ? `可以交了：${ready.title.zh}`
              : `Ready: ${ready.title.en}`
            : next
              ? next.title[zh ? "zh" : "en"]
              : offered.length
                ? zh
                  ? "今天的都做完了！"
                  : "All done for today!"
                : zh
                  ? "打开看看今天的事"
                  : "See today's errands"}
        </span>
      </button>
      <button
        type="button"
        className="tcard-collect"
        onClick={() => (play("tap"), onCollection())}
        aria-label={zh ? `收藏 ${have}/${all}：${parts}` : `Collection ${have} of ${all}: ${parts}`}
        title={parts}
      >
        <b>{zh ? "收藏" : "Collection"}</b>
        <span>
          {have}/{all}
        </span>
      </button>
    </div>
  );
}

const WANT_ORDER = ["idle", "eat", "play", "sleep", "explore", "sulk", "cuddle", "share"] as const;

/**
 * G9: what the pet chose today, replayed from its own log (the Rewind's record): how many of each choice and how many
 * a lesson its owner taught made. Worked out again only every ten beats, so a live pet stays light.
 */
function TodayChoices({ pet }: { pet: Pet }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const tick = Math.floor(pet.beat / 10);
  const day = useMemo(() => {
    const at = gameNow();
    const local = at + pet.tzOffsetMin * 60_000;
    const midnight = local - (local % 86_400_000) - pet.tzOffsetMin * 60_000;
    const back = Math.min(pet.pendingLog.length, Math.ceil((at - midnight) / 60_000) + 1);
    return dayChoices(rewind(pet, mindForPet(pet), back), midnight);
    // the pet changes every beat; today's choices only need working out again every ten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, pet.lessons, pet.bornAt]);
  if (!day.total) return null;
  // D6: its rest is told in its habit's way (a shy pet hides away, a playful one bounces about)
  const habit = strongestHabit(pet.traits);
  const kinds = WANT_ORDER.map((k, i) => ({ k, i, n: day.counts[k] ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  return (
    <p className="today-choices" aria-label={zh ? `${pet.name}今天的选择` : `What ${pet.name} chose today`}>
      <b>{zh ? `${pet.name}今天选了：` : `Today ${pet.name} chose:`}</b>{" "}
      {kinds.map((x) => (
        <span key={x.k} className="tc-kind" style={{ background: WANT_COLORS[x.i] }}>
          {x.k === "idle" && habit ? HABIT_REST[habit][zh ? "zh" : "en"] : WANT_NAMES[zh ? "zh" : "en"][x.i]} ×{x.n}
        </span>
      ))}
      {day.taught > 0 && (
        <span className="tc-taught">
          {zh ? `其中 ${day.taught} 次是因为你教过` : `${day.taught} because you taught it`}
        </span>
      )}
    </p>
  );
}

/** D2: today's village happening, a different one every day, with what to do about it. */
function VillageLine({ pet }: { pet: Pet }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const world = useWorld((s) => s.world);
  const all = useReveal((s) => s.all);
  const at = gameNow();
  // D9: the day's happening is in a room the map reaches (a shop, a lucky room, a resident's house), so it is told
  // from the day the map opens, never pointing a new player at a lock
  if (!isOpen("map", pet, all, at)) return null;
  const h = happeningAt(world, at);
  const done = happeningUsed(world, at);
  const name = (i: number) => ITEM[i]?.name[zh ? "zh" : "en"] ?? "";
  // D24: from 6 pm the village comes home: the gift waits at the door, the lucky find drifts home, the market halves
  const evening = villageEvening(world, at);
  const door = giftAtDoor(world, at);
  const takeGift = () => {
    const item = useWorld.getState().villageGift("door");
    if (item !== null)
      useWorld.setState({ notice: { id: Date.now(), kind: "bought", items: [{ item, n: 1 }] } } as never);
  };
  const eveningNote = done
    ? ""
    : evening
      ? h.kind === "market"
        ? zh
          ? `傍晚了，最后一个半价：${marketPrice(world, at)} 金币。`
          : ` It is evening: the last one is half price, ${marketPrice(world, at)} coins.`
        : h.kind === "lucky"
          ? zh
            ? "傍晚了，好运飘回了家：在家四处找找也会多找到一样。"
            : " It is evening: the luck has drifted home, so a look around at home finds one more too."
          : zh
            ? "傍晚了，礼物放在你家门口。"
            : " It is evening: the gift is waiting at your door."
      : zh
        ? "（傍晚 6 点后它会来到你家。）"
        : " (From 6 pm it comes to your home.)";
  const text =
    h.kind === "market"
      ? zh
        ? `集市日：街角小店今天卖${name(h.item)}，${h.price} 金币。`
        : `Market day: the Corner Shop sells ${name(h.item)} today, ${h.price} coins.`
      : h.kind === "lucky"
        ? zh
          ? `${ROOMS[h.room]?.name.zh ?? ""}的幸运日：今天第一次在那里四处找找会多找到一样。`
          : `Lucky day at the ${ROOMS[h.room]?.name.en ?? ""}: your first look around there today finds one more thing.`
        : zh
          ? `${CHARACTERS.find((c) => c.id === h.who)?.name.zh ?? ""}今天给你准备了小礼物，去说说话吧。`
          : `${CHARACTERS.find((c) => c.id === h.who)?.name.en ?? ""} has a little gift for you today. Go and say hello.`;
  return (
    <p className={`village-line${done ? " done" : ""}`}>
      <b>{zh ? "今天的村子" : "Today in the village"}</b> · {text}
      {eveningNote}
      {done && <span>{zh ? "（已经领到了）" : " (done)"}</span>}
      {door && (
        <button type="button" className="link village-door" onClick={takeGift}>
          {zh ? "从门口拿进来" : "Take it in from the door"}
        </button>
      )}
    </p>
  );
}

/** G4: the world's season now and the next one, so there is always something on its way, never a countdown to miss. */
function SeasonLine() {
  const { lang } = useLang();
  const at = gameNow();
  const season = worldSeasonAt(at);
  const next = nextWorldSeason(at);
  const days = Math.max(1, Math.ceil((next.at - at) / 86_400_000));
  const zh = lang === "zh";
  return (
    <p className={`season-line season-${season.id}`}>
      <b>{season.name[zh ? "zh" : "en"]}</b> · {season.air[zh ? "zh" : "en"]}{" "}
      <span>
        {zh
          ? `${days} 天后是${next.season.name.zh}`
          : `${next.season.name.en} in ${days} ${days === 1 ? "day" : "days"}`}
      </span>
    </p>
  );
}

/**
 * G3: how much the pet is enjoying the attention. Care that answers a need fills it and teaches the pet something; once
 * it is full the pet has had plenty for now, and says so, so a player knows why more fussing teaches nothing.
 */
function EnjoyBar({ pet }: { pet: Pet }) {
  const t = useT();
  const enjoy = pet.enjoy ?? 0;
  const full = enjoy + ENJOY_PER_CARE > ENJOY_MAX;
  return (
    <div className={`enjoy${full ? " full" : ""}`}>
      <span className="small">{full ? t("enjoy.full", { name: pet.name }) : t("enjoy.label")}</span>
      <i
        className="enjoy-bar"
        role="meter"
        aria-label={t("enjoy.label")}
        aria-valuemin={0}
        aria-valuemax={ENJOY_MAX}
        aria-valuenow={enjoy}
      >
        <i style={{ transform: `scaleX(${enjoy / ENJOY_MAX})` }} />
      </i>
    </div>
  );
}

export function ThinkStrip({ pet, taught = false }: { pet: Pet; taught?: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const kind = pet.last.instinct ? "instinct" : ruleKindOf(pet, decidingPart(pet).program, pet.last.rule);
  const c = pet.last.instinct
    ? lang === "zh"
      ? { when: ["它学会的本能电路想做点什么"], then: WANT_NAMES.zh[pet.last.want] ?? "", want: pet.last.want }
      : {
          when: ["its taught instinct circuit wanted something"],
          then: WANT_NAMES.en[pet.last.want] ?? "",
          want: pet.last.want,
        }
    : decidingChips(decidingPart(pet).program, pet.last.rule, lang);
  return (
    <div className={`think${taught ? " taught" : ""}`} aria-live="off">
      <em>{t(taught ? "try.mark" : "think.label")}</em>
      <Chips when={c.when} then={c.then} want={c.want} />
      {/* where the deciding rule came from (G1) */}
      <span className={`rule-tag tag-${kind}`}>{t(`rule.kind.${kind}` as Key)}</span>
    </div>
  );
}

/** The pet's own words for what its circuit just decided; fades after a few seconds. */
/**
 * The pet's words. They are shown in the room's notice lane (A15), at the top of the room and away from the pet, so a
 * tail pointing down would point at whatever happens to be under the lane (B4: on a desktop, the chimney); the pet's
 * own face beside the words says who is speaking instead.
 */
export function VoiceBubble({ face }: { face?: ReactNode }) {
  const { line, id, hush } = useVoice();
  useEffect(() => {
    if (!line) return;
    const t = setTimeout(hush, 6500);
    return () => clearTimeout(t);
  }, [id, line, hush]);
  return (
    <AnimatePresence>
      {line && (
        <motion.p
          key={id}
          className="voice"
          role="status"
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
        >
          {face && (
            <span className="voice-face" aria-hidden="true">
              {face}
            </span>
          )}
          <span>{line}</span>
        </motion.p>
      )}
    </AnimatePresence>
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
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {t(`note.${toast.note}` as Key, { name })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type Tab = "home" | "map" | "bag" | "mind" | "spar" | "me" | "quests" | "pets" | "games" | "mail" | "collection";
const TABS: ReadonlyArray<[Tab, IconName, Key]> = [
  ["home", "home", "tab.home"],
  ["map", "map", "tab.map"],
  ["bag", "bag", "tab.bag"],
  ["mind", "mind", "tab.mind"],
  ["spar", "paw", "tab.spar"],
  ["me", "pet", "tab.me"],
];

export function TabBar({
  current,
  onPick,
  locked = [],
}: {
  current: Tab;
  onPick: (t: Tab) => void;
  locked?: readonly Tab[];
}) {
  const t = useT();
  return (
    <nav className="tabs" aria-label={t("lang") === "EN" ? "主菜单" : "Main"}>
      {TABS.map(([id, icon, label]) => (
        <button
          key={id}
          type="button"
          className={`tab${locked.includes(id) ? " tab-locked" : ""}`}
          aria-current={current === id ? "page" : undefined}
          onClick={() => onPick(id)}
          data-hint={`tab-${id}`}
        >
          <Icon name={icon} size={22} />
          {t(label)}
          {locked.includes(id) && (
            <span className="tab-lock" aria-label={t("reveal.locked")}>
              <Icon name="lock" size={10} />
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}

/** The pet's level on its avatar: a tap opens the skills, or levels up when the XP is there. */
function LevelBadge({ pet }: { pet: Pet }) {
  const zh = useLang((s) => s.lang) === "zh";
  const g = growthOf(pet);
  const ready = canLevelUp(g, pet.xp);
  return (
    <button
      type="button"
      className={`lv-chip${ready ? " ready" : ""}`}
      onClick={() => (ready ? levelUpNow() : useSkillsUi.getState().show())}
      aria-label={
        zh
          ? ready
            ? `${g.level} 级 · 升级`
            : `${g.level} 级 · 技能`
          : ready
            ? `Lv ${g.level} · level up`
            : `Lv ${g.level} · skills`
      }
    >
      {ready ? "▲" : ""}
      {g.level}
      {!ready && g.points > 0 && <b aria-hidden="true" />}
    </button>
  );
}
