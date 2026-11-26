/**
 * P7: the room's panels around the pet, out of PlayApp. CareColumn is the side of the screen: the thinking strip on a
 * landscape phone, the meters, the care actions and the mind card. RoomNotes are what the room says over itself: the
 * pet away with a friend, the pet away on a trip, and the one message over the world. LockedTab asks before a part of
 * the game opens ahead of its day.
 */
import { useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Pet } from "@lingxi/game";
import { DESTINATION } from "@lingxi/world";
import { useQuestUi } from "../../game/quests";
import { type Gated, OPENS_ON } from "../../game/reveal";
import { play } from "../../game/sound";
import { useGame } from "../../game/store";
import { useWorld } from "../../game/world";
import { type Key, useT } from "../../i18n";
import { deferred } from "../Lazy";
import { Actions, Meters, type Tab, ThinkStrip } from "../parts";
import { useScrollEdges } from "../scrollEdges";
import { MindPanel } from "../Sheets";
import { useWorldMessage } from "./worldMessage";

const AwayCard = deferred(() => import("../Sitting").then((x) => x.AwayCard));

type Lang = "en" | "zh";

export function CareColumn({
  pet,
  lang,
  talking,
  thinking,
  taught,
  pick,
}: {
  pet: Pet;
  lang: Lang;
  talking: boolean;
  /** the pet the thinking strip shows: itself, or as a lesson being tried shows it */
  thinking: Pet;
  /** the lesson being tried fired */
  taught: boolean;
  pick: (t: Tab, force?: boolean) => void;
}) {
  const t = useT();
  const act = useGame((s) => s.act);
  const travelling = useWorld((s) => !!s.world.trip);
  // R23: the mind card's list fades at the edge that hides more, never ending on half a row with no sign of the rest
  const mindBox = useRef<HTMLDivElement>(null);
  useScrollEdges(mindBox);
  // Play opens the three mini-games
  const playBall = () => pick("games");
  const clean = () => {
    play("sparkle");
    act({ kind: "clean" });
  };
  const sleep = () => {
    play("tap");
    act(pet.asleep ? { kind: "wake" } : { kind: "lightsOff" });
  };
  return (
    <div className="side">
      {/* a landscape phone shows the thinking strip here, beside the room, where it cannot hide the pet (H5) */}
      {!talking && (
        <div className="think-side">
          <ThinkStrip pet={thinking} taught={taught} />
        </div>
      )}
      <Meters pet={pet} />
      {/* feeding is care: Feed opens the bag on day 1 too, though the Bag tab waits for day 2 (H5b) */}
      <Actions
        pet={pet}
        absent={travelling}
        onFeed={() => pick("bag", true)}
        onPlay={playBall}
        onClean={clean}
        onSleep={sleep}
        onMedicine={() => (play("sparkle"), act({ kind: "medicine" }))}
        onToday={() => (useQuestUi.getState().setBookTab("today"), pick("quests"))}
        onCollection={() => pick("collection")}
      />
      <section className="card mindcard">
        <div className="cardbar" aria-hidden="true">
          <i />
          <i />
          <i />
          {lang === "zh" ? `${pet.name}的心智` : `${pet.name.toLowerCase()}.mind`}
        </div>
        {/* P5: on a desktop this card scrolls on its own; the keyboard reaches it, named by its heading */}
        <div ref={mindBox} className="pad" tabIndex={0} role="region" aria-labelledby="mindcard-h">
          <h2 className="h2" id="mindcard-h">
            {t("mind.title", { name: pet.name })}
          </h2>
          <MindPanel pet={pet} />
        </div>
      </section>
    </div>
  );
}

export function RoomNotes({ pet, lang, pick }: { pet: Pet; lang: Lang; pick: (t: Tab) => void }) {
  const trip = useWorld((s) => s.world.trip);
  const worldMsg = useWorldMessage((s) => s.msg);
  return (
    <>
      {pet.away && <AwayCard pet={pet} />}
      {trip && (
        <div className="trip-note" role="status">
          <p>
            {lang === "zh"
              ? `${pet.name}出门旅行了，在${DESTINATION[trip.to]?.name.zh ?? ""}。`
              : `${pet.name} is away at ${DESTINATION[trip.to]?.name.en.toLowerCase() ?? ""}.`}
          </p>
          <button type="button" className="btn" onClick={() => pick("map")}>
            {lang === "zh" ? "看看它什么时候回来" : "See when it's back"}
          </button>
        </div>
      )}
      <AnimatePresence>
        {worldMsg && (
          <motion.div
            key={worldMsg.id}
            className="toast world-toast"
            role="status"
            initial={{ opacity: 0, y: -12, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -8, x: "-50%" }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          >
            {worldMsg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function LockedTab({
  gate,
  petName,
  onWait,
  onOpenAll,
}: {
  gate: Gated;
  petName: string;
  onWait: () => void;
  onOpenAll: () => void;
}) {
  const t = useT();
  return (
    <div className="fam-modal" role="dialog" aria-modal="true" aria-label={t("reveal.title")}>
      <div className="fam-card reveal-card">
        <p>{t(`reveal.${gate}` as Key, { name: petName, day: OPENS_ON[gate] })}</p>
        <p className="small">{t("reveal.why")}</p>
        <div className="row">
          <button type="button" className="btn" onClick={onWait}>
            {t("reveal.wait")}
          </button>
          <button type="button" className="btn primary" onClick={onOpenAll}>
            {t("reveal.openAll")}
          </button>
        </div>
      </div>
    </div>
  );
}
