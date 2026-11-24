/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { Suspense, lazy, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { NIGHT, boundingBox, drawPet } from "@lingxi/art";
import { STARTERS } from "@lingxi/brain";
import { type Pet, visitorsNow, stageOf, strongestHabit, visibleMeters } from "@lingxi/game";
import { type Key, useT, useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { decidingPart, useGame } from "../game/store";
import { ruleKindOf } from "../game/ruleKind";
import { chirp, play } from "../game/sound";
import { setAmbience } from "../game/music";
import { DecorBar } from "./DecorBar";
import { NoticeLane } from "./NoticeLane";
import { Familiar } from "./Familiar";
// Collection is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./badges.css";
import { useTrial, type Trial } from "../game/tryIt";
import type { Rule } from "@lingxi/brain";
import { BadgeToast } from "./Badges";
import { type DayPhase, phaseNow } from "../scene/dayPhase";
import { weatherFor } from "../scene/weather";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { Hatch } from "./Hatch";
import { useGameServices } from "./app/useGameServices";
import { useWorldMessage } from "./app/worldMessage";
import { useWorldNotices } from "./app/useWorldNotices";
import { useLiveRoom } from "./app/useLiveRoom";
import { useResidentTalk } from "./app/useResidentTalk";
import { TabSheets } from "./app/TabSheets";
import { VisitorCards } from "./app/VisitorCards";
import { PetButton } from "./PetButton";
import { OfflineNote } from "./OfflineNote";
import { useHatchDraft } from "./hatchDraft";
import { Actions, Meters, TabBar, ThinkStrip, ToastView, TopBar, VoiceBubble, type Tab } from "./parts";
import { useVoice } from "../game/voice";
import { MindPanel, Sheet } from "./Sheets";
// WorldPanels is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./cute.css";
import "./world.css";
// Quests is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./goals.css";
import "./quests.css";
import { RulesMark } from "./RulesMark";
import { useQuestUi } from "../game/quests";
import { useWorld } from "../game/world";
import { playerId, useLive, visitingFrom } from "../game/live";
import { type Action, CHARACTER_IN_ROOM, HOME, INDOOR_ROOMS, ROOMS, decorOf, neighbours } from "@lingxi/world";
// Talk is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./talk.css";
import "./neighbours.css";
// Games is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./games.css";
// Duel is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./arena.css";
import "./rewind.css";
import "./arenarun.css";
import "./season.css";
import { WelcomeBack } from "./Welcome";
// Sitting is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./handheld.css";
import "./adoption.css";
import { type Gated, OPENS_ON, isOpen, openedByQuests, useReveal } from "../game/reveal";
// Gift is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./gift.css";
// RedPacket is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./redpacket.css";
// Family is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./family.css";
import { AnimatePresence, motion } from "motion/react";
// Teach is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./teach.css";
import { BEHEMOTH, startDuel, startFight, useArena } from "../game/arenaFight";
import { LevelUpMoment, SkillsPanel, useSkillsUi } from "./Skills";
import { SHY_ONE } from "./Album";
import { needsOf, showNeeds } from "../game/badge";
import { BUILDER_PETS, builderIn } from "@lingxi/game";
import { builderInScene } from "../game/builderScene";
import { telegramBack } from "../game/telegram";
import { useMove } from "../game/move";
import { MoveNotes, MoveSheet } from "./Move";
import { deferred } from "./Lazy";
import { RIG_HOME_BGS, useHoldings } from "../game/holders";
import { unreadCount, useMail } from "../game/mail";
import { DESTINATION, outfitOf } from "@lingxi/world";
import { Icon } from "./icons";
import { Sprite } from "./Sprite";
import "./play.css";
import { ElsewhereOverlay, SaveBanner } from "./SaveScreens";
import { SaveFileSheet, useSaveFileUi } from "./SaveFile";
import { now } from "../game/gameClock";

// P3: the room scene and its engine (PIXI) load beside the game, not before it: the screens paint first
const RoomScene = lazy(() => import("../scene/RoomScene").then((m) => ({ default: m.RoomScene })));

/** P3: panels behind `Lazy` whose code loads only when their place comes near (each module holds only that panel). */
const HintRing = deferred(() => import("./Quests").then((x) => x.HintRing));
const PetQuestBubble = deferred(() => import("./Quests").then((x) => x.PetQuestBubble));
const QuestDialog = deferred(() => import("./Quests").then((x) => x.QuestDialog));
const QuestToast = deferred(() => import("./Quests").then((x) => x.QuestToast));
const SocialBar = deferred(() => import("./Social").then((x) => x.SocialBar));
const Talk = deferred(() => import("./Talk").then((x) => x.Talk));
const DuelArrival = deferred(() => import("./Duel").then((x) => x.DuelArrival));
const AwayCard = deferred(() => import("./Sitting").then((x) => x.AwayCard));
const SitArrival = deferred(() => import("./Sitting").then((x) => x.SitArrival));
const GiftArrival = deferred(() => import("./Gift").then((x) => x.GiftArrival));
const PacketArrival = deferred(() => import("./RedPacket").then((x) => x.PacketArrival));
const NewbornDialog = deferred(() => import("./Family").then((x) => x.NewbornDialog));
const ProposalDialog = deferred(() => import("./Family").then((x) => x.ProposalDialog));
const CircuitOverlay = deferred(() => import("./CircuitOverlay").then((x) => x.CircuitOverlay));
const BuilderCard = deferred(() => import("./Builders").then((x) => x.BuilderCard));
const FarewellNote = deferred(() => import("./Adoption").then((x) => x.FarewellNote));
const HandheldReturn = deferred(() => import("./Handheld").then((x) => x.HandheldReturn));

/** where Flit's shy visitor lives (room 56) */
const BUTTERFLY_FOREST = 56;

function drawnStage(s: string): PetStage {
  return s === "elder" ? "adult" : (s as PetStage);
}

/** When each visiting relative said hello this hour, so the greeting shows once on arrival. */
const KIN_HELLO: Record<string, number> = {};

/** The pet as the staged moment shows it: the decision the trial made, by the half of its mind that made it. */
function trialPet(pet: Pet, trial: Trial & { lesson: Rule }): Pet {
  const { instinct: _instinct, half: _half, ...last } = pet.last;
  const time = trial.senses.time;
  return {
    ...pet,
    last: {
      ...last,
      want: trial.want,
      mood: trial.mood,
      rule: trial.rule,
      ...(pet.family ? { half: time === 1 || time === 2 ? (0 as const) : (1 as const) } : {}),
    },
  };
}

export function PlayApp() {
  const { pet, toast, daily, lastCare, hatch, act, tick, wakeUp, say } = useGame();
  const t = useT();
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<Tab>("home");
  // the work the game keeps running while it is open: letters, the clock, chain reads, voice, reminders, auto-save
  useGameServices();
  // H5: a lesson tried out right after it was taught: the room shows it for a few seconds
  const trial = useTrial((s) => s.trial);
  // G1: what the room shows: a lesson being tried brings its own moment; otherwise the living room's last event
  const roomEvent = useGame((s) => s.roomEvent);
  const roomEventProps = trial
    ? { event: trial.senses.event, eventAt: trial.shownAt }
    : roomEvent
      ? { event: roomEvent.event, eventAt: roomEvent.at }
      : {};
  // and the room comes back to show it, whatever sheet the lesson was taught from
  useEffect(
    () =>
      useTrial.subscribe(
        (s, prev) => ((s.trial && s.trial !== prev.trial) || s.watching !== prev.watching) && setTab("home"),
      ),
    [],
  );
  const [phase, setPhase] = useState<DayPhase>(phaseNow);
  const [circuit, setCircuit] = useState(false);
  const worldRoom = useWorld((s) => s.world.room);
  // one message over the world at a time (play/app/worldMessage.ts); what raises one on its own is in useWorldNotices
  const worldMsg = useWorldMessage((s) => s.msg);
  const setWorldMsg = useWorldMessage((s) => s.show);
  useWorldNotices();
  const worldFull = useWorld((s) => s.world);
  const travelling = !!worldFull.trip;
  const mailState = useMail();
  const unread = unreadCount(mailState);
  const homeDecor = useLive((s) => s.homeDecor);
  const worldMove = useWorld((s) => s.move);
  const worldForage = useWorld((s) => s.forage);
  const familiar = useWorld((s) => s.world.familiar);
  const room = ROOMS[worldRoom] ?? ROOMS[HOME]!;
  // X2: a rig holder's own home wears the rig-bay skin (a friend's home keeps its own look)
  const rigSkin = useHoldings((s) => !!s.held?.rig && s.skinOn);
  // what the room sounds like: rain outdoors on a rainy day, else birds by day and crickets at night
  const outdoors = !INDOOR_ROOMS.has(worldRoom);
  useEffect(() => {
    setAmbience(
      outdoors && weatherFor(new Date(now())) === "rain"
        ? "rain"
        : !outdoors
          ? "quiet"
          : phase === "night"
            ? "crickets"
            : phase === "day"
              ? "birds"
              : "quiet",
    );
    return () => setAmbience("quiet");
  }, [outdoors, phase]);
  // who the pet can talk to here, the mark over their head, and the talk ending when the room changes
  const { who, visitor, guest, talking, setTalking, startTalk, npcMark, npcFace, setNpcFace, questStatuses } =
    useResidentTalk(worldRoom);
  const skillsOpen = useSkillsUi((s) => s.open);
  const [visiting, setVisiting] = useState<string | null>(() => visitingFrom());
  const revealAll = useReveal((s) => s.all);
  const [lockedAsk, setLockedAsk] = useState<Gated | null>(null);
  // decorating the home: null when not decorating, else the piece in hand ("" for none yet)
  const [decorating, setDecorating] = useState<string | null>(null);
  const others = useLive((s) => s.members);
  const roster = useGame((s) => s.pets);
  const [hourNow, setHourNow] = useState(() => Math.floor(now() / 3_600_000));
  const petCount = useGame((s) => s.pets.length);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedBuilder = picked?.startsWith("builder:")
    ? (BUILDER_PETS.find((x) => `builder:${x.id}` === picked) ?? null)
    : null;
  // a resident says hello when the room is entered
  const [residentSaid, setResidentSaid] = useState(() => performance.now() + 600);
  useEffect(
    () =>
      useWorld.subscribe((s, before) => {
        if (s.world.room !== before.world.room) setResidentSaid(performance.now() + 600);
      }),
    [],
  );
  const space = worldRoom === HOME ? `home:${visiting ?? playerId()}` : `room:${worldRoom}`;
  // the live room: joining it, sharing the pet's card and mood, and what other pets there do (play/app/useLiveRoom.ts)
  useLiveRoom(space, () => setTab("spar"));
  // leaving a friend's home brings you back to your own the next time you go home, and the address says so
  if (worldRoom !== HOME && visiting) setVisiting(null);
  useEffect(() => {
    if (worldRoom !== HOME && visitingFrom()) history.replaceState(null, "", location.pathname);
  }, [worldRoom]);

  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("play");

  // one live beat a minute while the app is open; catch up on return
  useEffect(() => {
    const id = setInterval(() => {
      tick();
      setPhase(phaseNow());
      setHourNow(Math.floor(now() / 3_600_000));
    }, 5_000);
    const onVis = () => {
      if (!document.hidden) {
        wakeUp();
        setPhase(phaseNow());
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tick, wakeUp]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useGame.setState({ toast: null }), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const close = useCallback(() => setTab("home"), []);
  // the spar screen closing, by any route, ends the fight on it, as the screen's own state would
  useEffect(() => {
    if (tab !== "spar") useArena.setState({ fight: null });
  }, [tab]);
  const onPetTap = useCallback(() => {
    const p = useGame.getState().pet;
    if (!p) return;
    if (p.asleep) {
      say("asleepTap");
      return;
    }
    chirp();
    act({ kind: "pet" });
    void useVoice.getState().speak(p, useLang.getState().lang as "en" | "zh", true);
  }, [act, say]);

  const stage = pet ? drawnStage(stageOf(pet, now())) : "baby";
  const petLine = pet?.line;
  const petForm = pet?.form;
  const face = useMemo(
    () => (petLine ? drawPet(petLine, stage, { expression: "happy", ...(petForm ? { form: petForm } : {}) }) : null),
    [petLine, stage, petForm],
  );

  // say so when a relative arrives (once per visit); the visitors themselves are drawn in the room
  const kinArrivals =
    pet && worldRoom === HOME && !visiting
      ? visitorsNow(pet, roster, hourNow)
          .map((k) => k.pet.name)
          .join(", ")
      : "";
  // once per hour and set of visitors, whatever else changes
  const kinVisit = kinArrivals && pet ? `${hourNow}:${pet.bornAt}:${kinArrivals}` : "";
  // said after the render, never during it: the message lives in a store other components read (React refuses one
  // component's render updating another's, CI 2026-11-25)
  const kinSeen = useRef<Set<string>>(new Set());
  const sayKin = useEffectEvent((visit: string, who: string) => {
    const name = useGame.getState().pet?.name ?? "";
    setWorldMsg({
      id: visit,
      text: lang === "zh" ? `${who}来看${name}了。` : `${who} dropped by to see ${name}.`,
      ms: 4500,
    });
  });
  useEffect(() => {
    if (!kinVisit || kinSeen.current.has(kinVisit)) return;
    kinSeen.current.add(kinVisit);
    sayKin(kinVisit, kinArrivals);
  }, [kinVisit, kinArrivals]);

  // S11: inside Telegram, its back button closes whichever sheet is open
  const moveAsk = useMove((s) => s.ask);
  useEffect(() => {
    telegramBack(moveAsk ? () => useMove.getState().closeOffer() : tab === "home" ? null : () => setTab("home"));
  }, [tab, moveAsk]);
  // Y1: the app icon shows how many things the pet needs (hooks stay above the hatch screen's early return)
  const needCount = pet ? needsOf(pet).length : 0;
  useEffect(() => {
    showNeeds(needCount);
  }, [needCount]);
  // a home-screen shortcut (Feed, Play, Teach) opens straight onto that screen once there is a pet
  const [shortcutTaken, setShortcutTaken] = useState(false);
  if (pet && !shortcutTaken) {
    setShortcutTaken(true);
    const go = new URLSearchParams(location.search).get("do");
    const to: Tab | null = go === "feed" ? "bag" : go === "play" ? "games" : go === "teach" ? "mind" : null;
    if (to) setTab(to);
  }
  if (!pet) {
    return (
      <>
        <Hatch
          onHatch={(line, name, instincts) => {
            hatch(line, name, instincts);
            useHatchDraft.getState().reset();
            play("success");
          }}
        />
        <GiftArrival />
        <PacketArrival />
        <DuelArrival hasPet={false} />
        <SitArrival />
        <FarewellNote />
        <HandheldReturn />
        <SaveBanner onSaveFile={() => useSaveFileUi.getState().show()} />
        <OfflineNote />
        <SaveFileSheet here={[]} />
        <MoveNotes />
        <ElsewhereOverlay />
      </>
    );
  }

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
  // a quest taken that points at a part opens it, so no quest sends the player to a lock (H5)
  const questOpened = openedByQuests(questStatuses);
  const lockedTabs = (["map", "bag", "spar"] as const).filter(
    (x) => !isOpen(x, pet, revealAll, undefined, questOpened),
  );
  /** `force` opens a tab even before its day, for flows the player chose (accepting a friend's challenge) */
  // relatives on this device drop by the home now and then (PRD G3)
  const KIN_WORD = {
    parent: { en: "parent", zh: "爸爸妈妈" },
    child: { en: "little one", zh: "孩子" },
    sibling: { en: "sibling", zh: "兄弟姐妹" },
  } as const;
  const kinVisitors =
    worldRoom === HOME && !visiting
      ? visitorsNow(pet, roster, hourNow).map((k, i) => ({
          id: `kin:${k.pet.bornAt}`,
          name: k.pet.name,
          line: k.pet.line,
          stage: stageOf(k.pet, now()),
          mood: 2,
          who:
            lang === "zh"
              ? `${pet.name}的${KIN_WORD[k.kin].zh}，从你的宠物里过来串门。`
              : `${pet.name}'s ${KIN_WORD[k.kin].en}, dropping by from your other pets.`,
          // a hello when they arrive this hour
          say: {
            text: lang === "zh" ? `来看看${pet.name}！` : `Came to see ${pet.name}!`,
            at: (KIN_HELLO[`${hourNow}:${k.pet.bornAt}`] ??= performance.now() + i * 400),
          },
        }))
      : [];
  // Flit's story (quests 42 and 43): at night something shy watches from the Butterfly Forest's trees; once it is a
  // friend it comes closer. Only at night, only in the forest, only after it has been seen.
  const forestFlags = worldFull.flags ?? [];
  const shyOne =
    worldRoom === BUTTERFLY_FOREST && phase === "night" && !visiting && forestFlags.includes("shy-visitor")
      ? {
          id: "shy:one",
          name: forestFlags.includes("shy-friend")
            ? SHY_ONE.name[lang]
            : lang === "zh"
              ? "某个害羞的家伙"
              : "Something shy",
          line: SHY_ONE.look.line,
          stage: SHY_ONE.look.stage,
          mood: forestFlags.includes("shy-friend") ? 2 : 0,
          look: {
            palette: { key: "night", colors: NIGHT },
            outfitAt: () => ({}),
            x: forestFlags.includes("shy-friend") ? 42 : 18,
          },
        }
      : null;
  // R2: a builder's pet lives in this room
  const resident = !visiting ? builderIn(worldRoom) : null;
  const pick = (next: Tab, force = false) => {
    play("tap");
    if (!force && (lockedTabs as readonly string[]).includes(next)) {
      setLockedAsk(next as Gated);
      return;
    }
    setTab(next === tab ? "home" : next);
  };

  return (
    <div className="app">
      <TopBar
        pet={pet}
        daily={daily}
        face={face && <FaceSprite canvas={face} line={pet.line} />}
        onQuests={() => pick("quests")}
        onPets={() => pick("pets")}
        petCount={petCount}
        onMail={() => pick("mail")}
        unread={unread}
      />
      {/* P5: the room's main landmark (the top bar is its header, the tab bar its navigation) */}
      <main className="main">
        <section className="stage" aria-label={pet.name} data-hint="pet">
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
                ...kinVisitors,
                ...(shyOne ? [shyOne] : []),
                ...(resident ? [builderInScene(resident, lang, residentSaid)] : []),
              ]}
              onOtherTap={(id) => (play("tap"), setPicked(id))}
              npc={who ? (talking && npcFace ? npcFace : who.stand) : null}
              npcMark={npcMark}
              onNpcTap={() => (setPicked(null), startTalk())}
            />
          </Suspense>
          {/* P5: the pet for the keyboard and for a screen reader (the canvas above is reachable by neither) */}
          <PetButton pet={pet} stage={stage} onPat={onPetTap} />
          <div className="room-pill">
            <b>{visiting && worldRoom === HOME ? (lang === "zh" ? "朋友家" : "A friend's home") : room.name[lang]}</b>
            {who && !talking && (
              <button type="button" onClick={startTalk}>
                {lang === "zh" ? `和${who.name.zh}说话` : `Talk to ${who.name.en}`}
              </button>
            )}
            {resident && (
              <button type="button" onClick={() => (play("tap"), setPicked(`builder:${resident.id}`))}>
                {lang === "zh" ? `见见${resident.name.zh}` : `Meet ${resident.name.en}`}
              </button>
            )}
            {room.drops.length > 0 && (
              <button type="button" onClick={() => (play("tap"), worldForage())} data-hint="look">
                {t("room.look")}
              </button>
            )}
            {room.drops.length > 0 && room.familiarSize > 0 && !visiting && (
              <Familiar known={familiar?.[room.index] ?? 0} size={room.familiarSize} />
            )}
            {room.shop.length > 0 && (
              <button type="button" onClick={() => pick("bag")}>
                {t("room.shop")}
              </button>
            )}
            {room.index === HOME && !visiting && decorating === null && (
              <button type="button" onClick={() => (play("tap"), setDecorating(""))}>
                {t("decor.title")}
              </button>
            )}
            {room.index !== HOME && neighbours(room.index).includes(HOME) && (
              <button type="button" onClick={() => worldMove(HOME)}>
                {t("room.home")}
              </button>
            )}
          </div>
          {decorating !== null && worldRoom === HOME && (
            <DecorBar
              selected={decorating || null}
              onSelect={(id) => setDecorating(id ?? "")}
              onDone={() => setDecorating(null)}
            />
          )}
          {circuit && <CircuitOverlay pet={pet} reduceMotion={reduce} />}
          <button
            type="button"
            className="circuit-btn"
            aria-pressed={circuit}
            aria-label={lang === "zh" ? "看它的电路" : "See its circuit"}
            onClick={() => (play("tap"), setCircuit((v) => !v))}
          >
            <Icon name="mind" size={22} />
          </button>
          {pet.away && <AwayCard pet={pet} />}
          {travelling && worldFull.trip && (
            <div className="trip-note" role="status">
              <p>
                {lang === "zh"
                  ? `${pet.name}出门旅行了，在${DESTINATION[worldFull.trip.to]?.name.zh ?? ""}。`
                  : `${pet.name} is away at ${DESTINATION[worldFull.trip.to]?.name.en.toLowerCase() ?? ""}.`}
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
          {who && talking && (
            <Talk
              who={who}
              visiting={!CHARACTER_IN_ROOM[worldRoom] && who.id === (visitor ?? guest)?.id}
              onFace={setNpcFace}
              onClose={() => (setTalking(false), setNpcFace(null))}
              onAction={(a: Action) => {
                setTalking(false);
                setNpcFace(null);
                if (a === "proof") window.open("/verify.html", "_blank", "noopener");
                else pick(a === "shop" ? "bag" : a);
              }}
            />
          )}
          <VisitorCards
            pet={pet}
            lang={lang === "zh" ? "zh" : "en"}
            picked={picked}
            setPicked={setPicked}
            shyOne={shyOne}
            forestFlags={forestFlags}
            kinVisitors={kinVisitors}
          />
          {/* the pet's "!" steps aside while the Decorate bar holds the top of the room (A14) */}
          {!talking && decorating === null && <PetQuestBubble />}
          {talking ? null : Object.keys(others).length > 0 ? (
            <SocialBar
              here={[...Object.values(others), ...kinVisitors, ...(shyOne ? [shyOne] : [])].map((o) => ({
                id: o.id,
                name: o.name,
              }))}
              onPick={(id) => setPicked(id)}
            />
          ) : (
            <ThinkStrip pet={trial ? trialPet(pet, trial) : pet} taught={!!trial?.fired} />
          )}
        </section>
        <div className="side">
          {/* a landscape phone shows the thinking strip here, beside the room, where it cannot hide the pet (H5) */}
          {!talking && (
            <div className="think-side">
              <ThinkStrip pet={trial ? trialPet(pet, trial) : pet} taught={!!trial?.fired} />
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
          <section className="card mindcard" aria-label={t("mind.title", { name: pet.name })}>
            <div className="cardbar" aria-hidden="true">
              <i />
              <i />
              <i />
              {lang === "zh" ? `${pet.name}的心智` : `${pet.name.toLowerCase()}.mind`}
            </div>
            {/* P5: on a desktop this card scrolls on its own; the keyboard reaches it, named by its heading */}
            <div className="pad" tabIndex={0} role="region" aria-labelledby="mindcard-h">
              <h2 className="h2" id="mindcard-h">
                {t("mind.title", { name: pet.name })}
              </h2>
              <MindPanel pet={pet} />
            </div>
          </section>
        </div>
      </main>
      <TabBar current={tab} onPick={pick} locked={lockedTabs} />
      {lockedAsk && (
        <div className="fam-modal" role="dialog" aria-modal="true" aria-label={t("reveal.title")}>
          <div className="fam-card reveal-card">
            <p>{t(`reveal.${lockedAsk}` as Key, { name: pet.name, day: OPENS_ON[lockedAsk] })}</p>
            <p className="small">{t("reveal.why")}</p>
            <div className="row">
              <button type="button" className="btn" onClick={() => setLockedAsk(null)}>
                {t("reveal.wait")}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  useReveal.getState().openAll();
                  const want = lockedAsk;
                  setLockedAsk(null);
                  setTab(want);
                }}
              >
                {t("reveal.openAll")}
              </button>
            </div>
          </div>
        </div>
      )}
      <ProposalDialog pet={pet} />
      <GiftArrival />
      <PacketArrival />
      <DuelArrival
        hasPet
        petName={pet.name}
        onAccept={(c) => {
          // the spar screen opens onto the fight (never toggled shut, whatever was open)
          startDuel(pet, c);
          setTab("spar");
        }}
      />
      <NewbornDialog pet={pet} />
      <WelcomeBack pet={pet} />
      <SitArrival />

      <TabSheets tab={tab} close={close} pick={pick} pet={pet} />

      {/* the room's notices, stacked in one lane under its top row (A15) */}
      <NoticeLane>
        {/* a lesson being tried out: the pet's words about it are the one thing shown (H5) */}
        {trial && !talking && tab === "home" && (
          <VoiceBubble face={face && <FaceSprite canvas={face} line={pet.line} />} />
        )}
        <QuestToast onOpenBook={() => pick("quests")} />
        <BadgeToast />
        <ToastView toast={toast} name={pet.name} />
        <RulesMark />
        {/* the pet's own words, last: a quest, a badge, a care note or the rules mark is shown first (H5) */}
        {/* the pet speaks in the room: with a sheet open over it, its passing words wait */}
        {!trial && !talking && !circuit && tab === "home" && (
          <VoiceBubble face={face && <FaceSprite canvas={face} line={pet.line} />} />
        )}
      </NoticeLane>
      <FarewellNote />
      <HandheldReturn />
      <QuestDialog />
      <HintRing />
      <Sheet
        open={skillsOpen}
        title={lang === "zh" ? `${pet.name}的技能` : `${pet.name}'s skills`}
        onClose={() => useSkillsUi.getState().hide()}
      >
        {skillsOpen && <SkillsPanel />}
      </Sheet>
      <LevelUpMoment />
      <Sheet
        open={!!pickedBuilder}
        title={pickedBuilder ? pickedBuilder.name[lang] : ""}
        onClose={() => setPicked(null)}
      >
        {pickedBuilder && (
          <BuilderCard
            b={pickedBuilder}
            pet={pet}
            onSpar={() => {
              setPicked(null);
              startFight(pet, BEHEMOTH.partner, { opponent: BEHEMOTH.opponent() });
              setTab("spar");
            }}
          />
        )}
      </Sheet>
      <MoveSheet />
      <MoveNotes />
      <SaveBanner onSaveFile={() => useSaveFileUi.getState().show()} />
      <OfflineNote />
      <SaveFileSheet here={roster.map((p) => p.name)} />
      <ElsewhereOverlay />
    </div>
  );
}

function FaceSprite({ canvas, line }: { canvas: ReturnType<typeof drawPet>; line: keyof typeof PALETTE_OF }) {
  const b = boundingBox(canvas);
  const side = Math.max(b.w, b.h);
  const crop = {
    x: Math.max(0, Math.round(b.x + b.w / 2 - side / 2)),
    y: Math.max(0, b.y + b.h - side),
    w: side,
    h: side,
  };
  return <Sprite canvas={canvas} palette={PALETTE_OF[line]} scale={36 / side} crop={crop} />;
}

export const STARTER_COUNT = Object.keys(STARTERS).length;

/** The mailbox: letters from Lingxi, and pet letters between friends over TapeRelay (H13). */
