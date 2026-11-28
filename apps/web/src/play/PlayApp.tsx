/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { boundingBox, drawPet } from "@lingxi/art";
import { STARTERS } from "@lingxi/brain";
import { type Pet, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";
import { useGame } from "../game/store";
import { chirp, play } from "../game/sound";
import { DecorBar } from "./DecorBar";
import { NoticeLane } from "./NoticeLane";
// Collection is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./badges.css";
import { useTrial, type Trial } from "../game/tryIt";
import type { Rule } from "@lingxi/brain";
import { BadgeToast } from "./Badges";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { Hatch } from "./Hatch";
import { useGameServices } from "./app/useGameServices";
import { useWorldNotices } from "./app/useWorldNotices";
import { useDialogOpen } from "./app/useDialogOpen";
import { useLiveRoom } from "./app/useLiveRoom";
import { useResidentTalk } from "./app/useResidentTalk";
import { useAppChrome } from "./app/useAppChrome";
import { RoomPill, RoomView } from "./app/RoomView";
import { CareColumn, LockedTab, RoomNotes } from "./app/RoomPanels";
import { useGameClock } from "./app/useGameClock";
import { useRoomVisitors } from "./app/useRoomVisitors";
import { TabSheets } from "./app/TabSheets";
import { VisitorCards } from "./app/VisitorCards";
import { Announcer } from "./Announcer";
import { PetButton } from "./PetButton";
import { OfflineNote } from "./OfflineNote";
import { useHatchDraft } from "./hatchDraft";
import { TabBar, ThinkStrip, ToastView, TopBar, VoiceBubble, type Tab } from "./parts";
import { useVoice } from "../game/voice";
import { Sheet } from "./Sheets";
// WorldPanels is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./cute.css";
import "./world.css";
// Quests is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./goals.css";
import "./quests.css";
import { RulesMark } from "./RulesMark";
import { useWorld } from "../game/world";
import { playerId, useLive, visitingFrom } from "../game/live";
import { type Action, CHARACTER_IN_ROOM, HOME } from "@lingxi/world";
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
import { type Gated, isOpen, openedByQuests, useReveal } from "../game/reveal";
// Gift is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./gift.css";
// RedPacket is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./redpacket.css";
// Family is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./family.css";
// Teach is loaded on first use (P3); its styles still load with the game, in their place (P3a)
import "./teach.css";
import { BEHEMOTH, startDuel, startFight, useArena } from "../game/arenaFight";
import { LevelUpMoment, SkillsPanel, useSkillsUi } from "./Skills";
import { BUILDER_PETS, builderIn } from "@lingxi/game";
import { MoveNotes, MoveSheet } from "./Move";
import { deferred } from "./Lazy";
import { unreadCount, useMail } from "../game/mail";
import { Icon } from "./icons";
import { Sprite } from "./Sprite";
import "./play.css";
import { ElsewhereOverlay, SaveBanner } from "./SaveScreens";
import { SaveFileSheet, useSaveFileUi } from "./SaveFile";
import { now } from "../game/gameClock";

// P3: the room scene and its engine (PIXI) load beside the game, not before it: the screens paint first

/** P3: panels behind `Lazy` whose code loads only when their place comes near (each module holds only that panel). */
const HintRing = deferred(() => import("./Quests").then((x) => x.HintRing));
const PetQuestBubble = deferred(() => import("./Quests").then((x) => x.PetQuestBubble));
const QuestDialog = deferred(() => import("./Quests").then((x) => x.QuestDialog));
const QuestToast = deferred(() => import("./Quests").then((x) => x.QuestToast));
const SocialBar = deferred(() => import("./Social").then((x) => x.SocialBar));
const Talk = deferred(() => import("./Talk").then((x) => x.Talk));
const DuelArrival = deferred(() => import("./Duel").then((x) => x.DuelArrival));
const SitArrival = deferred(() => import("./Sitting").then((x) => x.SitArrival));
const GiftArrival = deferred(() => import("./Gift").then((x) => x.GiftArrival));
const PacketArrival = deferred(() => import("./RedPacket").then((x) => x.PacketArrival));
const NewbornDialog = deferred(() => import("./Family").then((x) => x.NewbornDialog));
const ProposalDialog = deferred(() => import("./Family").then((x) => x.ProposalDialog));
const CircuitOverlay = deferred(() => import("./CircuitOverlay").then((x) => x.CircuitOverlay));
const BuilderCard = deferred(() => import("./Builders").then((x) => x.BuilderCard));
const FarewellNote = deferred(() => import("./Adoption").then((x) => x.FarewellNote));
const HandheldReturn = deferred(() => import("./Handheld").then((x) => x.HandheldReturn));

function drawnStage(s: string): PetStage {
  return s === "elder" ? "adult" : (s as PetStage);
}

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
  const { pet, daily, act, say } = useGame();
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
  const [circuit, setCircuit] = useState(false);
  // R35: the sheets that open on their own rather than as a tab (the skills from the level chip, the save file): the
  // pet's passing words wait while they are open too, as they do for a tab's (in landscape they lay on the sheet)
  const skillsOpen = useSkillsUi((s) => s.open);
  const saveFileOpen = useSaveFileUi((s) => s.open);
  // R36: and while a dialog lies over the room (a quest's lines, a gift): the pet speaks in the dialog, not over it
  const dialogOpen = useDialogOpen();
  const worldRoom = useWorld((s) => s.world.room);
  // what raises a message over the world on its own (play/app/useWorldNotices.ts)
  useWorldNotices();
  const worldFull = useWorld((s) => s.world);
  const mailState = useMail();
  const unread = unreadCount(mailState);
  // the clock: the beat, the time of day and the hour, the room's sound, the care toast (play/app/useGameClock.ts)
  const { phase, hourNow } = useGameClock(worldRoom);
  // who the pet can talk to here, the mark over their head, and the talk ending when the room changes
  const { who, visitor, guest, talking, setTalking, startTalk, npcMark, npcFace, setNpcFace, questStatuses } =
    useResidentTalk(worldRoom);
  const [visiting, setVisiting] = useState<string | null>(() => visitingFrom());
  const revealAll = useReveal((s) => s.all);
  const [lockedAsk, setLockedAsk] = useState<Gated | null>(null);
  // decorating the home: null when not decorating, else the piece in hand ("" for none yet)
  const [decorating, setDecorating] = useState<string | null>(null);
  const others = useLive((s) => s.members);
  const roster = useGame((s) => s.pets);
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

  // relatives dropping by and the shy one in the night forest (play/app/useRoomVisitors.ts)
  const { kinVisitors, shyOne } = useRoomVisitors({
    pet,
    roster,
    worldRoom,
    visiting,
    hourNow,
    phase,
    flags: worldFull.flags ?? [],
    lang: lang === "zh" ? "zh" : "en",
  });
  // Telegram's back button, the app icon's count, a home-screen shortcut (play/app/useAppChrome.ts)
  useAppChrome(pet, tab, setTab);
  if (!pet) return <HatchScreen />;

  // a quest taken that points at a part opens it, so no quest sends the player to a lock (H5)
  const questOpened = openedByQuests(questStatuses);
  const lockedTabs = (["map", "bag", "spar"] as const).filter(
    (x) => !isOpen(x, pet, revealAll, undefined, questOpened),
  );
  const forestFlags = worldFull.flags ?? [];
  // R2: a builder's pet lives in this room
  const resident = !visiting ? builderIn(worldRoom) : null;
  /** `force` opens a tab even before its day, for flows the player chose (accepting a friend's challenge) */
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
        <section
          className="stage"
          aria-label={pet.name}
          data-hint="pet"
          data-decorating={decorating !== null && worldRoom === HOME ? "" : undefined}
        >
          <RoomView
            pet={pet}
            stage={stage}
            phase={phase}
            tab={tab}
            lang={lang === "zh" ? "zh" : "en"}
            trial={trial}
            roomEventProps={roomEventProps}
            visiting={visiting}
            decorating={decorating}
            setDecorating={setDecorating}
            onPetTap={onPetTap}
            reduce={reduce}
            visitors={[...kinVisitors, ...(shyOne ? [shyOne] : [])]}
            resident={resident}
            residentSaid={residentSaid}
            setPicked={setPicked}
            who={who}
            talking={talking}
            npcFace={npcFace}
            npcMark={npcMark}
            startTalk={startTalk}
          />
          {/* P5: the pet for the keyboard and for a screen reader (the canvas above is reachable by neither) */}
          <PetButton pet={pet} stage={stage} onPat={onPetTap} />
          <RoomPill
            lang={lang === "zh" ? "zh" : "en"}
            visiting={visiting}
            who={who}
            talking={talking}
            startTalk={startTalk}
            resident={resident}
            setPicked={setPicked}
            decorating={decorating}
            setDecorating={setDecorating}
            pick={pick}
          />
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
          <RoomNotes pet={pet} lang={lang === "zh" ? "zh" : "en"} pick={pick} />
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
        <CareColumn
          pet={pet}
          lang={lang === "zh" ? "zh" : "en"}
          talking={talking}
          thinking={trial ? trialPet(pet, trial) : pet}
          taught={!!trial?.fired}
          pick={pick}
          decor={
            decorating !== null && worldRoom === HOME ? (
              <DecorBar
                selected={decorating || null}
                onSelect={(id) => setDecorating(id ?? "")}
                onDone={() => setDecorating(null)}
              />
            ) : undefined
          }
        />
      </main>
      <TabBar current={tab} onPick={pick} locked={lockedTabs} />
      {lockedAsk && (
        <LockedTab
          gate={lockedAsk}
          petName={pet.name}
          onWait={() => setLockedAsk(null)}
          onOpenAll={() => {
            useReveal.getState().openAll();
            const want = lockedAsk;
            setLockedAsk(null);
            setTab(want);
          }}
        />
      )}
      <RoomDialogs pet={pet} onDuel={() => setTab("spar")} />

      <TabSheets tab={tab} close={close} pick={pick} pet={pet} />

      <PetNotices
        pet={pet}
        face={face}
        trial={!!trial}
        quiet={talking || tab !== "home" || skillsOpen || saveFileOpen || !!pickedBuilder || dialogOpen}
        circuit={circuit}
        pick={pick}
      />
      <FarewellNote />
      <HandheldReturn />
      <QuestDialog />
      <HintRing />
      <SkillsSheet pet={pet} lang={lang === "zh" ? "zh" : "en"} />
      <LevelUpMoment />
      <BuilderSheet
        builder={pickedBuilder}
        pet={pet}
        lang={lang === "zh" ? "zh" : "en"}
        onClose={() => setPicked(null)}
        onSpar={() => setTab("spar")}
      />
      <MoveSheet />
      <MoveNotes />
      <SaveBanner onSaveFile={() => useSaveFileUi.getState().show()} />
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

/** What can arrive over the room: a proposal, a gift, a red packet, a duel, a newborn, a welcome back, a sitting. */
function RoomDialogs({ pet, onDuel }: { pet: Pet; onDuel: () => void }) {
  return (
    <>
      <ProposalDialog pet={pet} />
      <GiftArrival />
      <PacketArrival />
      <DuelArrival
        hasPet
        petName={pet.name}
        onAccept={(c) => {
          // the spar screen opens onto the fight (never toggled shut, whatever was open)
          startDuel(pet, c);
          onDuel();
        }}
      />
      <NewbornDialog pet={pet} />
      <WelcomeBack pet={pet} />
      <SitArrival />
    </>
  );
}

/**
 * The room's notices, stacked in one lane under its top row (A15). `quiet`: the pet is talking, or a sheet or a dialog
 * is open, so its passing words wait; `trial`: a lesson is being tried, and the pet's words about it are the one thing
 * shown (H5).
 */
function PetNotices({
  pet,
  face,
  trial,
  quiet,
  circuit,
  pick,
}: {
  pet: Pet;
  face: ReturnType<typeof drawPet> | null;
  trial: boolean;
  quiet: boolean;
  circuit: boolean;
  pick: (t: Tab) => void;
}) {
  const toast = useGame((s) => s.toast);
  return (
    <>
      <NoticeLane>
        {/* R24: while the connection is down, first and for as long as it lasts; the notices below still take turns */}
        <OfflineNote />
        {/* a lesson being tried out: the pet's words about it are the one thing shown (H5) */}
        {trial && !quiet && <VoiceBubble face={face && <FaceSprite canvas={face} line={pet.line} />} />}
        <QuestToast onOpenBook={() => pick("quests")} />
        <BadgeToast />
        <ToastView toast={toast} name={pet.name} />
        <RulesMark />
        {/* the pet's own words, last: a quest, a badge, a care note or the rules mark is shown first (H5) */}
        {/* the pet speaks in the room: with a sheet open over it, its passing words wait */}
        {!trial && !quiet && !circuit && <VoiceBubble face={face && <FaceSprite canvas={face} line={pet.line} />} />}
      </NoticeLane>
      {/* R8: the care note and the pet's words, said aloud for a screen reader, whenever they are on screen */}
      <Announcer name={pet.name} voice={!quiet && (trial || !circuit)} />
    </>
  );
}

/** The pet's skills, opened from the level chip or the Pet sheet. */
function SkillsSheet({ pet, lang }: { pet: Pet; lang: "en" | "zh" }) {
  const skillsOpen = useSkillsUi((s) => s.open);
  return (
    <Sheet
      open={skillsOpen}
      title={lang === "zh" ? `${pet.name}的技能` : `${pet.name}'s skills`}
      onClose={() => useSkillsUi.getState().hide()}
    >
      {skillsOpen && <SkillsPanel />}
    </Sheet>
  );
}

/** A builder's pet met in its room (R2), with a spar against the Behemoth it guards. */
function BuilderSheet({
  builder,
  pet,
  lang,
  onClose,
  onSpar,
}: {
  builder: (typeof BUILDER_PETS)[number] | null;
  pet: Pet;
  lang: "en" | "zh";
  onClose: () => void;
  onSpar: () => void;
}) {
  return (
    <Sheet open={!!builder} title={builder ? builder.name[lang] : ""} onClose={onClose}>
      {builder && (
        <BuilderCard
          b={builder}
          pet={pet}
          onSpar={() => {
            onClose();
            startFight(pet, BEHEMOTH.partner, { opponent: BEHEMOTH.opponent() });
            onSpar();
          }}
        />
      )}
    </Sheet>
  );
}

/** Before there is a pet: the hatching, and what can still arrive or be restored without one. */
function HatchScreen() {
  const hatch = useGame((s) => s.hatch);
  return (
    <>
      {/* R24: no room yet, so no lane: the note heads the page, in its flow, over nothing */}
      <OfflineNote />
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
      <SaveFileSheet here={[]} />
      <MoveNotes />
      <ElsewhereOverlay />
    </>
  );
}
