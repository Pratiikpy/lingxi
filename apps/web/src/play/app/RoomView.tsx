/**
 * P7: the room as it is drawn and named, out of PlayApp. RoomView hands the scene everything it draws: the pet as it
 * is (or as a lesson being tried shows it), the room's picture for the time of day, its decorations (the player's own
 * or the friend's being visited), and everyone in it: other players' pets, relatives, the shy one, a builder's pet and
 * the room's character. RoomPill names the room and holds what can be done in it.
 */
import { lazy, Suspense } from "react";
import type { Rule } from "@lingxi/brain";
import { type Pet, strongestHabit, visibleMeters } from "@lingxi/game";
import { type BuilderPet } from "@lingxi/game";
import { HOME, INDOOR_ROOMS, decorOf, neighbours, outfitOf, roomOrHome } from "@lingxi/world";
import { builderInScene } from "../../game/builderScene";
import { RIG_HOME_BGS, useHoldings } from "../../game/holders";
import { useLive } from "../../game/live";
import { ruleKindOf } from "../../game/ruleKind";
import { play } from "../../game/sound";
import { decidingPart, useGame } from "../../game/store";
import type { Trial } from "../../game/tryIt";
import { useWorld } from "../../game/world";
import { useT } from "../../i18n";
import type { DayPhase } from "../../scene/dayPhase";
import type { PetStage } from "../../scene/palette";
import { Familiar } from "../Familiar";
import { Icon, type IconName } from "../icons";
import type { Tab } from "../parts";

const RoomScene = lazy(() => import("../../scene/RoomScene").then((m) => ({ default: m.RoomScene })));

type Lang = "en" | "zh";
/** someone besides the pet the scene draws: another player's pet, a relative, the shy one */
type Other = Parameters<typeof import("../../scene/RoomScene").RoomScene>[0]["others"][number];
/** the room's character, while there is one to talk to */
interface Who {
  stand: string;
  name: { en: string; zh: string };
}

export function RoomView({
  pet,
  stage,
  phase,
  tab,
  lang,
  trial,
  roomEventProps,
  visiting,
  decorating,
  setDecorating,
  onPetTap,
  reduce,
  visitors,
  resident,
  residentSaid,
  setPicked,
  who,
  talking,
  npcFace,
  npcMark,
  startTalk,
}: {
  pet: Pet;
  stage: PetStage;
  phase: DayPhase;
  tab: Tab;
  lang: Lang;
  /** a lesson being tried out: the room shows the moment it brings */
  trial: (Trial & { lesson: Rule }) | null;
  roomEventProps: { event?: number; eventAt?: number };
  visiting: string | null;
  decorating: string | null;
  setDecorating: (d: string | null) => void;
  onPetTap: () => void;
  reduce: boolean;
  /** relatives and the shy one, drawn with the other pets */
  visitors: readonly Other[];
  resident: BuilderPet | null;
  residentSaid: number;
  setPicked: (id: string | null) => void;
  who: Who | null;
  talking: boolean;
  npcFace: string | null;
  npcMark: "!" | "✓" | "★" | null;
  startTalk: () => void;
}) {
  const worldFull = useWorld((s) => s.world);
  const worldRoom = worldFull.room;
  const travelling = !!worldFull.trip;
  const homeDecor = useLive((s) => s.homeDecor);
  const others = useLive((s) => s.members);
  const lastCare = useGame((s) => s.lastCare);
  // X2: a rig holder's own home wears the rig-bay skin (a friend's home keeps its own look)
  const rigSkin = useHoldings((s) => !!s.held?.rig && s.skinOn);
  const room = roomOrHome(worldRoom);
  return (
    <Suspense fallback={null}>
      <RoomScene
        line={pet.line}
        stage={stage}
        {...(pet.form ? { form: pet.form } : {})}
        asleep={pet.asleep}
        absent={travelling}
        outfit={outfitOf(worldFull, String(pet.bornAt))}
        sick={!!pet.sick}
        want={trial ? trial.want : pet.last.want}
        habit={strongestHabit(pet.traits)}
        mood={trial ? trial.mood : pet.last.mood}
        {...roomEventProps}
        taught={
          trial
            ? trial.fired
            : !pet.last.instinct && ruleKindOf(pet, decidingPart(pet).program, pet.last.rule) === "taught"
        }
        phase={phase}
        lastCare={lastCare}
        clean={visibleMeters(pet).clean}
        food={visibleMeters(pet).food}
        outdoors={!INDOOR_ROOMS.has(worldRoom)}
        covered={tab !== "home"}
        decor={
          worldRoom !== HOME
            ? []
            : !visiting
              ? decorOf(worldFull).placed
              : homeDecor?.owner === visiting
                ? homeDecor.placed
                : []
        }
        decorating={decorating !== null && worldRoom === HOME && !visiting}
        onPlace={(x, y) => {
          // a piece put down leaves the player's hand, and the bar opens again for the next (P3a)
          if (decorating && useWorld.getState().placeDecor(decorating, x, y)) setDecorating("");
        }}
        onDecorTap={(id) => {
          useWorld.getState().removeDecor(id);
          setDecorating(id);
        }}
        onPetTap={onPetTap}
        reduceMotion={reduce}
        bgs={worldRoom === HOME && rigSkin && !visiting ? RIG_HOME_BGS : room.bgs}
        others={[
          ...Object.values(others),
          ...visitors,
          ...(resident ? [builderInScene(resident, lang, residentSaid)] : []),
        ]}
        onOtherTap={(id) => (play("tap"), setPicked(id))}
        npc={who ? (talking && npcFace ? npcFace : who.stand) : null}
        npcMark={npcMark}
        onNpcTap={() => (setPicked(null), startTalk())}
      />
    </Suspense>
  );
}

export function RoomPill({
  lang,
  visiting,
  who,
  talking,
  startTalk,
  resident,
  setPicked,
  decorating,
  setDecorating,
  pick,
}: {
  lang: Lang;
  visiting: string | null;
  who: Who | null;
  talking: boolean;
  startTalk: () => void;
  resident: BuilderPet | null;
  setPicked: (id: string | null) => void;
  decorating: string | null;
  setDecorating: (d: string | null) => void;
  pick: (t: Tab) => void;
}) {
  const t = useT();
  const worldRoom = useWorld((s) => s.world.room);
  const familiar = useWorld((s) => s.world.familiar);
  const worldMove = useWorld((s) => s.move);
  const worldForage = useWorld((s) => s.forage);
  const room = roomOrHome(worldRoom);
  return (
    <div className="room-pill">
      {/* R21: the room's name carries how well the pet knows it; where the room is narrow the two read as one chip */}
      <span className="room-name">
        <b>{visiting && worldRoom === HOME ? (lang === "zh" ? "朋友家" : "A friend's home") : room.name[lang]}</b>
        {room.drops.length > 0 && room.familiarSize > 0 && !visiting && (
          <Familiar known={familiar?.[room.index] ?? 0} size={room.familiarSize} />
        )}
      </span>
      {who && !talking && (
        <RoomAct icon="talk" onClick={startTalk}>
          {lang === "zh" ? `和${who.name.zh}说话` : `Talk to ${who.name.en}`}
        </RoomAct>
      )}
      {resident && (
        <RoomAct icon="hand" onClick={() => (play("tap"), setPicked(`builder:${resident.id}`))}>
          {lang === "zh" ? `见见${resident.name.zh}` : `Meet ${resident.name.en}`}
        </RoomAct>
      )}
      {room.drops.length > 0 && (
        <RoomAct icon="look" onClick={() => (play("tap"), worldForage())} hint="look">
          {t("room.look")}
        </RoomAct>
      )}
      {room.shop.length > 0 && (
        <RoomAct icon="bag" onClick={() => pick("bag")}>
          {t("room.shop")}
        </RoomAct>
      )}
      {room.index === HOME && !visiting && decorating === null && (
        <RoomAct icon="sofa" onClick={() => (play("tap"), setDecorating(""))}>
          {t("decor.title")}
        </RoomAct>
      )}
      {room.index !== HOME && neighbours(room.index).includes(HOME) && (
        <RoomAct icon="home" onClick={() => worldMove(HOME)}>
          {t("room.home")}
        </RoomAct>
      )}
    </div>
  );
}

/**
 * One of the room's actions. Where the room is wide it reads as its words; where it is narrow (a phone, a phone turned
 * sideways) it is its icon alone, its words kept for a screen reader and for every test that finds it by them, so
 * the room's controls take one row above the pet (R21).
 */
function RoomAct({
  icon,
  onClick,
  hint,
  children,
}: {
  icon: IconName;
  onClick: () => void;
  hint?: string;
  children: string;
}) {
  return (
    <button type="button" className="room-act" onClick={onClick} data-hint={hint}>
      <Icon name={icon} size={20} className="room-act-icon" />
      <span className="room-act-words">{children}</span>
    </button>
  );
}
