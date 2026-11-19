/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { OnChainNote } from "../OnChainNote";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { NIGHT, boundingBox, drawPet } from "@lingxi/art";
import { STARTERS, timeOfDay } from "@lingxi/brain";
import { type Pet, visitorsNow, friendPartner, petCard, stageOf, visibleMeters, bondLevel } from "@lingxi/game";
import { type Key, useT, useLang } from "../i18n";
import { useGame } from "../game/store";
import { chirp, play } from "../game/sound";
import { followClock, setAmbience } from "../game/music";
import { useReminders } from "../game/reminders";
import { RemindersPanel } from "./Reminders";
import { DecorBar } from "./DecorBar";
import { NoticeLane } from "./NoticeLane";
import { BadgeShelf, BadgeToast } from "./Badges";
import { type DayPhase, RoomScene, weatherFor } from "../scene/RoomScene";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Hatch } from "./Hatch";
import { Actions, Meters, TabBar, ThinkStrip, ToastView, TopBar, VoiceBubble, type Tab } from "./parts";
import { useVoice } from "../game/voice";
import { EvolutionChart, MeSheetBody, MindPanel, Sheet } from "./Sheets";
import { BagPanel, MapPanel, noticeText } from "./WorldPanels";
import { HintRing, PetQuestBubble, QuestBook, QuestDialog, QuestToast } from "./Quests";
import { RulesMark } from "./RulesMark";
import { questsOf, useQuestStatuses } from "../game/quests";
import { useWorld } from "../game/world";
import { recordOf, useChain } from "../game/chain";
import { liveAvailable, playerId, useLive, visitingFrom } from "../game/live";
import { InvitePanel, SocialBar } from "./Social";
import { type Action, CHARACTERS, CHARACTER_IN_ROOM, FRIEND_BY_ID, HOME, INDOOR_ROOMS, ROOMS, decorOf, neighbours, openSteps, visitorOf } from "@lingxi/world";
import { Talk } from "./Talk";
import { GamesPanel } from "./Games";
import { DiaryPanel } from "./Diary";
import { RewindPanel } from "./Rewind";
import { DuelArrival } from "./Duel";
import { WelcomeBack } from "./Welcome";
import { AwayCard, SitArrival, SitPanel } from "./Sitting";
import { type Gated, OPENS_ON, isOpen, useReveal } from "../game/reveal";
import { GiftArrival, SendGiftPanel } from "./Gift";
import { PacketArrival, RedPacketPanel } from "./RedPacket";
import { FamilyTree, NewbornDialog, PetsPanel, ProposalDialog, bondBlock, familyBlock } from "./Family";
import { AnimatePresence, motion } from "motion/react";
import { TeachPanel } from "./Teach";
import { ArenaPanel, BEHEMOTH, startDuel, startFight, useArena } from "./Arena";
import { BrainView } from "./BrainView";
import { ChainPanel } from "./ChainPanel";
import { NeighboursPanel } from "./Neighbours";
import { LevelUpMoment, SkillsPanel, useSkillsUi } from "./Skills";
import { HomePanel } from "./Home";
import { WardrobePanel } from "./Wardrobe";
import { MailboxPanel } from "./Mailbox";
import { AlbumPanel, SHY_ONE } from "./Album";
import { FriendsPanel } from "./Friends";
import { HoldersPanel } from "./Holders";
import { StudioPanel } from "./Studio";
import { needsOf, showNeeds } from "../game/badge";
import { BUILDER_PETS, builderIn } from "@lingxi/game";
import { BuilderCard, builderInScene } from "./Builders";
import { telegramBack } from "../game/telegram";
import { useMove } from "../game/move";
import { MoveNotes, MoveSheet, TelegramCard } from "./Move";
import { Lazy } from "./Lazy";
import { FashionMarketPanel } from "./FashionMarket";
import { ItemShopPanel } from "./ItemShop";
import { ExtrasPanel } from "./Extras";
import { AdoptionPanel, FarewellNote } from "./Adoption";
import { HandheldPanel, HandheldReturn } from "./Handheld";
import { syncChainPieces } from "../game/chainDecor";
import { loadColours, syncPacks } from "../game/extras";
import { RIG_HOME_BGS, useHoldings } from "../game/holders";
import { bondName, bondsOf, friendKey, useFriends } from "../game/friends";
import { unreadCount, useMail } from "../game/mail";
import { Outings } from "./Outings";
import { DESTINATION, outfitOf } from "@lingxi/world";
import { Icon } from "./icons";
import { Sprite } from "./Sprite";
import "./play.css";
import { ElsewhereOverlay, SaveBanner } from "./SaveScreens";
import { SaveFileCard, SaveFileSheet, useSaveFileUi } from "./SaveFile";
import { now } from "../game/gameClock";

/** where Flit's shy visitor lives (room 56) */
const BUTTERFLY_FOREST = 56;

function phaseNow(): DayPhase {
  const t = timeOfDay(new Date(now()).getHours());
  return t === 0 ? "night" : t === 3 ? "evening" : "day";
}

function drawnStage(s: string): PetStage {
  return s === "elder" ? "adult" : (s as PetStage);
}

/** When each visiting relative said hello this hour, so the greeting shows once on arrival. */
const KIN_HELLO: Record<string, number> = {};

export function PlayApp() {
  const { pet, toast, daily, lastCare, hatch, act, tick, wakeUp, say } = useGame();
  const t = useT();
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<Tab>("home");
  const [phase, setPhase] = useState<DayPhase>(phaseNow);
  const [circuit, setCircuit] = useState(false);
  const worldRoom = useWorld((s) => s.world.room);
  // one message over the world at a time, each for as long as it takes to read; a newer one replaces it
  const [worldMsg, setWorldMsg] = useState<{ id: number | string; text: string; ms: number } | null>(null);
  useEffect(() => {
    if (!worldMsg) return;
    const id = setTimeout(() => setWorldMsg(null), worldMsg.ms);
    return () => clearTimeout(id);
  }, [worldMsg]);
  // a birth sent before the page closed and found on X Layer since: its little one comes home now (A48)
  const welcomeFound = useEffectEvent((found: Array<{ child: Pet }>) => {
    for (const { child } of found) if (useGame.getState().adopt(child)) play("success");
    if (found.length)
      setWorldMsg({
        id: `births:${found.map((f) => f.child.bornAt).join(",")}`,
        text: lang === "zh" ? `${found.map((f) => f.child.name).join("、")}在 X Layer 上出生了，已经回到你的宠物里。` : `${found.map((f) => f.child.name).join(" and ")} was born on X Layer and has joined your pets.`,
        ms: 6000,
      });
  });
  useEffect(() => {
    void useChain.getState().finishBirths().then(welcomeFound);
  }, []);
  const worldFull = useWorld((s) => s.world);
  const travelling = !!worldFull.trip;
  const mailState = useMail();
  const unread = unreadCount(mailState);
  const { loaded: mailLoaded, fetch: fetchMail } = mailState;
  useEffect(() => {
    if (!mailLoaded) void fetchMail();
  }, [mailLoaded, fetchMail]);
  const homeDecor = useLive((s) => s.homeDecor);
  const placedDecor = decorOf(worldFull).placed;
  // our home's decorations live on the server too, so friends who drop by see them
  useEffect(() => {
    if (liveAvailable()) useLive.getState().shareDecor(placedDecor);
  }, [placedDecor]);
  // the server didn't keep our decorations: say so, since visitors will not see them
  // shown once per refusal, in the language of that moment
  const sayDecorRefused = useEffectEvent((refused: NonNullable<ReturnType<typeof useLive.getState>["decorRefused"]>) => {
    const text =
      refused.reason === "tooMany"
        ? lang === "zh"
          ? "访客明天才能看到你的新布置：这个网络地址今天开的新家够多了。"
          : "Visitors will see your new decorations from tomorrow: this address has started enough new homes today."
        : lang === "zh"
          ? "访客暂时看不到你的布置，下次改动时会再发送。"
          : "Visitors can't see your decorations for now; they'll be sent again on your next change.";
    setWorldMsg({ id: Math.round(refused.at), text, ms: 6000 });
  });
  useEffect(() => useLive.subscribe((s, before) => s.decorRefused && s.decorRefused !== before.decorRefused && sayDecorRefused(s.decorRefused)), []);
  const worldMove = useWorld((s) => s.move);
  const worldForage = useWorld((s) => s.forage);
  const familiar = useWorld((s) => s.world.familiar);
  useEffect(followClock, []);
  // on-chain decorations and limited outfits the wallets hold (plans 4.6, 4.9): read on start, so a piece sold
  // elsewhere leaves the home; then the extras packs and the name colours of the pets on this device
  useEffect(() => {
    void syncChainPieces();
    void syncPacks();
    void loadColours(useGame.getState().pets.map((p) => recordOf(p)?.petId ?? "").filter(Boolean));
  }, []);
  // the pet says something when its circuit makes a new decision
  const decision = pet ? `${pet.last.rule}|${pet.asleep}|${Boolean(pet.sick)}` : "";
  useEffect(() => {
    const p = useGame.getState().pet;
    if (p && decision) void useVoice.getState().speak(p, useLang.getState().lang as "en" | "zh");
  }, [decision]);
  // reminders follow the pet: a fresh plan shortly after each change, and at once when the player leaves
  useEffect(() => {
    const send = () => {
      const p = useGame.getState().pet;
      if (p) void useReminders.getState().replan(p, useLang.getState().lang as "en" | "zh");
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useGame.subscribe((s, prev) => {
      if (s.pet === prev.pet) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, 20_000);
    });
    const onHide = () => document.hidden && send();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);
  // auto-save: when a new chain day starts, save it through the device key, never through a wallet pop-up
  const autoOn = useChain((s) => Boolean(s.record?.autoUntil));
  useEffect(() => {
    if (!autoOn) return;
    const run = () => {
      const p = useGame.getState().pet;
      if (p) void useChain.getState().saveToday(p, () => useGame.getState().say("saved"), true);
    };
    run();
    const id = setInterval(run, 10 * 60_000);
    return () => clearInterval(id);
  }, [autoOn]);
  // a new notice on every event, in the words and language of that moment
  const sayNotice = useEffectEvent((notice: NonNullable<ReturnType<typeof useWorld.getState>["notice"]>) => {
    const text = noticeText(notice, t, lang);
    if (text) setWorldMsg({ id: notice.id, text, ms: 2800 });
  });
  useEffect(() => useWorld.subscribe((s, before) => s.notice && s.notice !== before.notice && sayNotice(s.notice)), []);
  const room = ROOMS[worldRoom] ?? ROOMS[HOME]!;
  // X2: a rig holder's own home wears the rig-bay skin (a friend's home keeps its own look)
  const rigSkin = useHoldings((s) => !!s.held?.rig && s.skinOn);
  // what the room sounds like: rain outdoors on a rainy day, else birds by day and crickets at night
  const outdoors = !INDOOR_ROOMS.has(worldRoom);
  useEffect(() => {
    setAmbience(outdoors && weatherFor(new Date(now())) === "rain" ? "rain" : !outdoors ? "quiet" : phase === "night" ? "crickets" : phase === "day" ? "birds" : "quiet");
    return () => setAmbience("quiet");
  }, [outdoors, phase]);
  // over the resident's head: a quest to hand in, or one to offer
  const worldState = useWorld((s) => s.world);
  const [talking, setTalking] = useState(false);
  const skillsOpen = useSkillsUi((s) => s.open);
  // a resident who has come to visit stands in your home until you meet them (plan 4.3)
  const visitorId = worldRoom === HOME ? visitorOf(worldState) : null;
  const visitor = visitorId ? (CHARACTERS.find((c) => c.id === visitorId) ?? null) : null;
  // meeting them sends them home, but not mid-sentence: whoever was visiting when the talk began stays until it ends
  const [guest, setGuest] = useState<typeof visitor>(null);
  const startTalk = () => {
    play("tap");
    setGuest(visitor);
    setTalking(true);
  };
  const who = CHARACTER_IN_ROOM[worldRoom] ?? visitor ?? (talking && worldRoom === HOME ? guest : null);
  const questStatuses = useQuestStatuses();
  const npcMark = useMemo<"!" | "✓" | "★" | null>(() => {
    if (!who) return null;
    const q = questsOf(who.id, questStatuses);
    const friend = FRIEND_BY_ID[who.id];
    // quests first; then a visitor waiting, or a friendship step open
    return q.ready.length ? "✓" : q.offer.length ? "!" : who === visitor || (friend && openSteps(worldState, friend).length) ? "★" : null;
  }, [who, questStatuses, visitor, worldState]);
  const [npcFace, setNpcFace] = useState<string | null>(null);
  // leaving a room ends a conversation in it
  const [talkRoom, setTalkRoom] = useState(worldRoom);
  if (talkRoom !== worldRoom) {
    setTalkRoom(worldRoom);
    setTalking(false);
    setNpcFace(null);
  }
  const [visiting, setVisiting] = useState<string | null>(() => visitingFrom());
  const revealAll = useReveal((s) => s.all);
  const [lockedAsk, setLockedAsk] = useState<Gated | null>(null);
  // decorating the home: null when not decorating, else the piece in hand ("" for none yet)
  const [decorating, setDecorating] = useState<string | null>(null);
  const others = useLive((s) => s.members);
  const roster = useGame((s) => s.pets);
  const [hourNow, setHourNow] = useState(() => Math.floor(now() / 3_600_000));
  const liveConnect = useLive((s) => s.connect);
  const liveMood = useLive((s) => s.mood);
  const liveEmote = useLive((s) => s.emote);
  const liveShare = useLive((s) => s.shareCard);
  const liveAsk = useLive((s) => s.ask);
  const livePropose = useLive((s) => s.propose);
  const meet = useFriends((s) => s.meet);
  const friendsAll = useFriends((s) => s.all);
  const sayLevelUp = useEffectEvent((up: NonNullable<ReturnType<typeof useFriends.getState>["levelUp"]>) => {
    play("success");
    setWorldMsg({ id: up.at, text: lang === "zh" ? `${useGame.getState().pet?.name ?? ""}和${up.name}成了${bondName(up.level, "zh")}！` : `${useGame.getState().pet?.name ?? "Your pet"} and ${up.name} are now ${bondName(up.level, "en").toLowerCase()}!`, ms: 4500 });
  });
  useEffect(() => useFriends.subscribe((s, before) => s.levelUp && s.levelUp !== before.levelUp && sayLevelUp(s.levelUp)), []);
  // ten minutes in the same room together is a moment shared with each pet there
  useEffect(() => {
    const id = setInterval(() => {
      for (const m of Object.values(useLive.getState().members)) meet(m.id, { name: m.name, line: m.line }, "together");
    }, 10 * 60_000);
    return () => clearInterval(id);
  }, [meet]);
  const petCount = useGame((s) => s.pets.length);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedBuilder = picked?.startsWith("builder:") ? (BUILDER_PETS.find((x) => `builder:${x.id}` === picked) ?? null) : null;
  // a resident says hello when the room is entered
  const [residentSaid, setResidentSaid] = useState(() => performance.now() + 600);
  useEffect(
    () =>
      useWorld.subscribe((s, before) => {
        if (s.world.room !== before.world.room) setResidentSaid(performance.now() + 600);
      }),
    [],
  );
  // the card carries the pet's memory, which changes every beat; so does the pet: one share per beat, as before
  useEffect(() => {
    if (pet) liveShare(petCard(pet));
  }, [pet, liveShare]);
  // a friend's card arriving opens a spar against it, with the pet as it is then; one that cannot spar says so, in the
  // language of that moment
  const takeCard = useEffectEvent((card: NonNullable<ReturnType<typeof useLive.getState>["card"]>) => {
    const partner = friendPartner(card);
    const p = useGame.getState().pet;
    if (!partner || !p) return setWorldMsg({ id: Math.round(card.at), text: lang === "zh" ? "没法和这只宠物切磋" : "Can't spar with that pet", ms: 3500 });
    startFight(p, partner);
    setTab("spar");
  });
  useEffect(() => useLive.subscribe((s, before) => s.card && s.card !== before.card && takeCard(s.card)), []);
  const saySparred = useEffectEvent((by: NonNullable<ReturnType<typeof useLive.getState>["asked"]>) =>
    setWorldMsg({ id: Math.round(by.at), text: lang === "zh" ? `${by.name}和${useGame.getState().pet?.name ?? ""}切磋了一场` : `${by.name} sparred with ${useGame.getState().pet?.name ?? "your pet"}`, ms: 4000 }),
  );
  useEffect(() => useLive.subscribe((s, before) => s.asked && s.asked !== before.asked && saySparred(s.asked)), []);
  const space = worldRoom === HOME ? `home:${visiting ?? playerId()}` : `room:${worldRoom}`;
  // leaving a friend's home brings you back to your own the next time you go home, and the address says so
  if (worldRoom !== HOME && visiting) setVisiting(null);
  useEffect(() => {
    if (worldRoom !== HOME && visitingFrom()) history.replaceState(null, "", location.pathname);
  }, [worldRoom]);
  const chainPetId = useChain((s) => s.record?.petId);
  // a room is joined again when the space, the pet's name or its chain id changes; it reads the rest fresh
  const petName = pet?.name;
  useEffect(() => {
    const p = useGame.getState().pet;
    if (!p || !liveAvailable()) return;
    liveConnect({ name: p.name, line: p.line, stage: stageOf(p, now()), mood: p.last.mood, ...(chainPetId ? { petId: chainPetId } : {}) }, space);
  }, [space, liveConnect, petName, chainPetId]);
  const mood = pet?.last.mood;
  useEffect(() => {
    if (mood !== undefined) liveMood(mood);
  }, [mood, liveMood]);
  // only a new incoming emote is answered; who sent it is read as the room is then
  const answerEmote = useEffectEvent((incoming: NonNullable<ReturnType<typeof useLive.getState>["incoming"]>) => {
    const who = others[incoming.from]?.name ?? "";
    const verbs: Record<string, [string, string]> = {
      wave: ["waved at you", "向你挥手"],
      heart: ["sent you a heart", "送你一颗心"],
      laugh: ["is laughing", "笑了"],
      dance: ["is dancing", "在跳舞"],
      sleepy: ["is sleepy", "困了"],
      gift: ["has a gift for you", "有礼物给你"],
    };
    const v = verbs[incoming.kind];
    if (!v || !who) return;
    const from = others[incoming.from];
    if (from) meet(from.id, { name: from.name, line: from.line }, incoming.kind === "heart" ? "heart" : incoming.kind === "gift" ? "gift" : "wave");
    setWorldMsg({ id: Math.round(incoming.at), text: lang === "zh" ? `${who}${v[1]}` : `${who} ${v[0]}`, ms: 3500 });
  });
  useEffect(() => useLive.subscribe((s, before) => s.incoming && s.incoming !== before.incoming && answerEmote(s.incoming)), []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

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
  const face = useMemo(() => (petLine ? drawPet(petLine, stage, { expression: "happy", ...(petForm ? { form: petForm } : {}) }) : null), [petLine, stage, petForm]);

  // say so when a relative arrives (once per visit); the visitors themselves are drawn in the room
  const kinArrivals = pet && worldRoom === HOME && !visiting ? visitorsNow(pet, roster, hourNow).map((k) => k.pet.name).join(", ") : "";
  // once per hour and set of visitors, whatever else changes
  const kinVisit = kinArrivals && pet ? `${hourNow}:${pet.bornAt}:${kinArrivals}` : "";
  const [kinSeen, setKinSeen] = useState<ReadonlySet<string>>(() => new Set());
  if (kinVisit && pet && !kinSeen.has(kinVisit)) {
    setKinSeen(new Set(kinSeen).add(kinVisit));
    setWorldMsg({ id: kinVisit, text: lang === "zh" ? `${kinArrivals}来看${pet.name}了。` : `${kinArrivals} dropped by to see ${pet.name}.`, ms: 4500 });
  }

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
  const lockedTabs = (["mind", "map", "bag", "spar"] as const).filter((x) => !isOpen(x, pet, revealAll));
  /** `force` opens a tab even before its day, for flows the player chose (accepting a friend's challenge) */
  // relatives on this device drop by the home now and then (PRD G3)
  const KIN_WORD = { parent: { en: "parent", zh: "爸爸妈妈" }, child: { en: "little one", zh: "孩子" }, sibling: { en: "sibling", zh: "兄弟姐妹" } } as const;
  const kinVisitors =
    worldRoom === HOME && !visiting
      ? visitorsNow(pet, roster, hourNow).map((k, i) => ({
          id: `kin:${k.pet.bornAt}`,
          name: k.pet.name,
          line: k.pet.line,
          stage: stageOf(k.pet, now()),
          mood: 2,
          who: lang === "zh" ? `${pet.name}的${KIN_WORD[k.kin].zh}，从你的宠物里过来串门。` : `${pet.name}'s ${KIN_WORD[k.kin].en}, dropping by from your other pets.`,
          // a hello when they arrive this hour
          say: { text: lang === "zh" ? `来看看${pet.name}！` : `Came to see ${pet.name}!`, at: (KIN_HELLO[`${hourNow}:${k.pet.bornAt}`] ??= performance.now() + i * 400) },
        }))
      : [];
  // Flit's story (quests 42 and 43): at night something shy watches from the Butterfly Forest's trees; once it is a
  // friend it comes closer. Only at night, only in the forest, only after it has been seen.
  const forestFlags = worldFull.flags ?? [];
  const shyOne =
    worldRoom === BUTTERFLY_FOREST && phase === "night" && !visiting && forestFlags.includes("shy-visitor")
      ? {
          id: "shy:one",
          name: forestFlags.includes("shy-friend") ? SHY_ONE.name[lang] : lang === "zh" ? "某个害羞的家伙" : "Something shy",
          line: SHY_ONE.look.line,
          stage: SHY_ONE.look.stage,
          mood: forestFlags.includes("shy-friend") ? 2 : 0,
          look: { palette: { key: "night", colors: NIGHT }, outfitAt: () => ({}), x: forestFlags.includes("shy-friend") ? 42 : 18 },
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
      <TopBar pet={pet} daily={daily} face={face && <FaceSprite canvas={face} line={pet.line} />} onQuests={() => pick("quests")} onPets={() => pick("pets")} petCount={petCount} onMail={() => pick("mail")} unread={unread} />
      <div className="main">
        <section className="stage" aria-label={pet.name} data-hint="pet">
          <RoomScene
            line={pet.line}
            stage={stage}
            {...(pet.form ? { form: pet.form } : {})}
            asleep={pet.asleep}
            absent={travelling}
            outfit={outfitOf(worldFull, String(pet.bornAt))}
            sick={!!pet.sick}
            want={pet.last.want}
            mood={pet.last.mood}
            phase={phase}
            lastCare={lastCare}
            clean={visibleMeters(pet).clean}
            food={visibleMeters(pet).food}
            outdoors={!INDOOR_ROOMS.has(worldRoom)}
            covered={tab !== "home"}
            decor={worldRoom !== HOME ? [] : !visiting ? decorOf(worldFull).placed : homeDecor?.owner === visiting ? homeDecor.placed : []}
            decorating={decorating !== null && worldRoom === HOME && !visiting}
            onPlace={(x, y) => {
              if (decorating) useWorld.getState().placeDecor(decorating, x, y);
            }}
            onDecorTap={(id) => {
              useWorld.getState().removeDecor(id);
              setDecorating(id);
            }}
            onPetTap={onPetTap}
            reduceMotion={reduce}
            bgs={worldRoom === HOME && rigSkin && !visiting ? RIG_HOME_BGS : room.bgs}
            others={[...Object.values(others), ...kinVisitors, ...(shyOne ? [shyOne] : []), ...(resident ? [builderInScene(resident, lang, residentSaid)] : [])]}
            onOtherTap={(id) => (play("tap"), setPicked(id))}
            npc={who ? (talking && npcFace ? npcFace : who.stand) : null}
            npcMark={npcMark}
            onNpcTap={() => (setPicked(null), startTalk())}
          />
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
              <span
                className="familiar"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={room.familiarSize}
                aria-valuenow={familiar?.[room.index] ?? 0}
                aria-label={lang === "zh" ? "对这里的熟悉程度" : "How well your pet knows this place"}
                title={lang === "zh" ? "常来这里找找，熟悉了会发现藏着的东西" : "Look around here often: a place you know shows you hidden things"}
              >
                <i style={{ width: `${Math.round((100 * (familiar?.[room.index] ?? 0)) / room.familiarSize)}%` }} />
              </span>
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
            <DecorBar selected={decorating || null} onSelect={(id) => setDecorating(id ?? "")} onDone={() => setDecorating(null)} />
          )}
          {circuit && (
            <div className="circuit-overlay">
              <BrainView pet={pet} reduceMotion={reduce} />
            </div>
          )}
          <button type="button" className="circuit-btn" aria-pressed={circuit} aria-label={lang === "zh" ? "看它的电路" : "See its circuit"} onClick={() => (play("tap"), setCircuit((v) => !v))}>
            <Icon name="mind" size={22} />
          </button>
          {pet.away && <AwayCard pet={pet} />}
          {travelling && worldFull.trip && (
            <div className="trip-note" role="status">
              <p>{lang === "zh" ? `${pet.name}出门旅行了，在${DESTINATION[worldFull.trip.to]?.name.zh ?? ""}。` : `${pet.name} is away at ${DESTINATION[worldFull.trip.to]?.name.en.toLowerCase() ?? ""}.`}</p>
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
          {picked === "shy:one" && shyOne && (
            <div className="visitor-card" role="dialog" aria-label={shyOne.name}>
              <b>{shyOne.name}</b>
              <span className="small">
                {forestFlags.includes("shy-friend")
                  ? lang === "zh"
                    ? `它现在敢待在${pet.name}身边了。白天你见不到它。`
                    : `It stays near ${pet.name} now. You will never see it by day.`
                  : lang === "zh"
                    ? `在树影边上看着${pet.name}，从不靠近。`
                    : `At the edge of the trees, watching ${pet.name}. It never comes close.`}
              </span>
              <button type="button" className="icon-x" aria-label={lang === "zh" ? "关闭" : "Close"} onClick={() => setPicked(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {picked?.startsWith("kin:") && kinVisitors.find((k) => k.id === picked) && (
            <div className="visitor-card" role="dialog" aria-label={kinVisitors.find((k) => k.id === picked)!.name}>
              <b>{kinVisitors.find((k) => k.id === picked)!.name}</b>
              <span className="small">{kinVisitors.find((k) => k.id === picked)!.who}</span>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const id = Number(picked.slice(4));
                  const index = roster.findIndex((x) => x.bornAt === id);
                  setPicked(null);
                  if (index >= 0) {
                    play("tap");
                    useGame.getState().switchTo(index);
                  }
                }}
              >
                {lang === "zh" ? "换成它" : "Switch to it"}
              </button>
              <button type="button" className="icon-x" aria-label={lang === "zh" ? "关闭" : "Close"} onClick={() => setPicked(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {picked && others[picked] && (
            <div className="visitor-card" role="dialog" aria-label={others[picked]!.name}>
              <b>{others[picked]!.name}</b>
              <span className="small visitor-bond">{bondName(bondLevel(bondsOf(friendsAll, pet.bornAt)[friendKey(picked, others[picked]!.name)]?.points ?? 0), lang)}</span>
              <button type="button" className="btn" onClick={() => (play("pop"), liveEmote("heart", picked), meet(picked, { name: others[picked]!.name, line: others[picked]!.line }, "heart"), setPicked(null))}>
                <Icon name="heart" size={16} /> {lang === "zh" ? "送心" : "Heart"}
              </button>
              <button type="button" className="btn primary" onClick={() => (play("tap"), liveAsk(picked), meet(picked, { name: others[picked]!.name, line: others[picked]!.line }, "spar"), setPicked(null))}>
                <Icon name="paw" size={16} /> {lang === "zh" ? "切磋" : "Spar"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const other = others[picked]!;
                  const block = familyBlock(pet, other.stage, lang) ?? bondBlock(pet, bondsOf(friendsAll, pet.bornAt)[friendKey(other.id, other.name)]?.points ?? 0, other.name, lang);
                  setPicked(null);
                  if (block) return setWorldMsg({ id: now(), text: block, ms: 4500 });
                  play("tap");
                  livePropose(other.id, useChain.getState().infoOf(pet) ?? undefined);
                  setWorldMsg({ id: now(), text: lang === "zh" ? `问过${other.name}的主人了，等回复……` : `Asked ${other.name}'s owner. Waiting for an answer…`, ms: 4000 });
                }}
              >
                <Icon name="heart" size={16} /> {lang === "zh" ? "家人" : "Family"}
              </button>
              <button type="button" className="icon-x" aria-label={lang === "zh" ? "关闭" : "Close"} onClick={() => setPicked(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {!talking && !circuit && <VoiceBubble />}
          {/* the pet's "!" steps aside while the Decorate bar holds the top of the room (A14) */}
          {!talking && decorating === null && <PetQuestBubble />}
          {talking ? null : Object.keys(others).length > 0 ? (
            <SocialBar
              here={[...Object.values(others), ...kinVisitors, ...(shyOne ? [shyOne] : [])].map((o) => ({ id: o.id, name: o.name }))}
              onPick={(id) => setPicked(id)}
            />
          ) : (
            <ThinkStrip pet={pet} />
          )}
        </section>
        <div className="side">
          <Meters pet={pet} />
          <Actions pet={pet} absent={travelling} onFeed={() => pick("bag")} onPlay={playBall} onClean={clean} onSleep={sleep} onMedicine={() => (play("sparkle"), act({ kind: "medicine" }))} />
          <section className="card mindcard" aria-label={t("mind.title", { name: pet.name })}>
            <div className="cardbar" aria-hidden="true">
              <i />
              <i />
              <i />
              {lang === "zh" ? `${pet.name}的心智` : `${pet.name.toLowerCase()}.mind`}
            </div>
            <div className="pad">
              <h2 className="h2">{t("mind.title", { name: pet.name })}</h2>
              <MindPanel pet={pet} />
            </div>
          </section>
        </div>
      </div>
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

      <Sheet open={tab === "bag"} title={t("bag.title")} onClose={close}>
        <BagPanel onFed={close} />
      </Sheet>
      <Sheet open={tab === "mail"} title={lang === "zh" ? "邮件" : "Mail"} onClose={close}>
        <MailboxPanel />
      </Sheet>
      <Sheet open={tab === "map"} title={t("map.title")} onClose={close}>
        <Outings pet={pet} />
        <MapPanel onGone={close} />
      </Sheet>
      <Sheet open={tab === "quests"} title={t("quest.title")} onClose={close}>
        <QuestBook />
      </Sheet>
      <Sheet open={tab === "mind"} title={t("teach.title", { name: pet.name })} onClose={close}>
        <TeachPanel pet={pet} />
        <hr className="divider" />
        <p className="small">{t("mind.title", { name: pet.name })}</p>
        <MindPanel pet={pet} />
      </Sheet>

      <Sheet open={tab === "spar"} title={lang === "zh" ? "切磋" : "Spar"} onClose={close}>
        <ArenaPanel pet={pet} />
      </Sheet>

      <Sheet open={tab === "games"} title={lang === "zh" ? "一起玩" : "Play together"} onClose={close}>
        <GamesPanel pet={pet} onDone={close} onSchool={() => pick("mind")} />
      </Sheet>

      <Sheet open={tab === "pets"} title={lang === "zh" ? "你的宠物" : "Your pets"} onClose={close}>
        <PetsPanel onPicked={close} />
      </Sheet>

      {/* the room's notices, stacked in one lane under its top row (A15) */}
      <NoticeLane>
        <QuestToast onOpenBook={() => pick("quests")} />
        <BadgeToast />
        <ToastView toast={toast} name={pet.name} />
        <RulesMark />
      </NoticeLane>
      <FarewellNote />
      <HandheldReturn />
      <QuestDialog />
      <HintRing />
      <Sheet open={skillsOpen} title={lang === "zh" ? `${pet.name}的技能` : `${pet.name}'s skills`} onClose={() => useSkillsUi.getState().hide()}>
        {skillsOpen && <SkillsPanel />}
      </Sheet>
      <LevelUpMoment />
      <Sheet open={tab === "me"} title={t("me.title", { name: pet.name })} onClose={close}>
        <TelegramCard />
        <SaveFileCard />
        <WardrobePanel pet={pet} />
        <hr className="divider" />
        <Lazy><StudioPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><FashionMarketPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><ItemShopPanel /></Lazy>
        <hr className="divider" />
        <Lazy><ExtrasPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><AdoptionPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><FriendsPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <NeighboursPanel />
        <hr className="divider" />
        <Lazy><HoldersPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><AlbumPanel /></Lazy>
        <hr className="divider" />
        <Lazy><MeSheetBody pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><DiaryPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><RewindPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><EvolutionChart pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><FamilyTree pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><InvitePanel /></Lazy>
        <hr className="divider" />
        <Lazy><SitPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><HandheldPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><OnChainNote lang={lang} /></Lazy>
        <hr className="divider" />
        <Lazy><SendGiftPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <Lazy><RedPacketPanel pet={pet} /></Lazy>
        <hr className="divider" />
        <BadgeShelf />
        <hr className="divider" />
        <RemindersPanel pet={pet} />
        <hr className="divider" />
        <ChainPanel pet={pet} />
        <hr className="divider" />
        <HomePanel pet={pet} />
      </Sheet>
      <Sheet open={!!pickedBuilder} title={pickedBuilder ? pickedBuilder.name[lang] : ""} onClose={() => setPicked(null)}>
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
      <SaveFileSheet here={roster.map((p) => p.name)} />
      <ElsewhereOverlay />
    </div>
  );
}

function FaceSprite({ canvas, line }: { canvas: ReturnType<typeof drawPet>; line: keyof typeof PALETTE_OF }) {
  const b = boundingBox(canvas);
  const side = Math.max(b.w, b.h);
  const crop = { x: Math.max(0, Math.round(b.x + b.w / 2 - side / 2)), y: Math.max(0, b.y + b.h - side), w: side, h: side };
  return <Sprite canvas={canvas} palette={PALETTE_OF[line]} scale={36 / side} crop={crop} />;
}

export const STARTER_COUNT = Object.keys(STARTERS).length;
