/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { OnChainNote } from "../OnChainNote";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { boundingBox, drawPet } from "@lingxi/art";
import { STARTERS, timeOfDay } from "@lingxi/brain";
import { type Challenge, type Partner, visitorsNow, friendPartner, petCard, stageOf, visibleMeters, bondLevel } from "@lingxi/game";
import { type Key, useT, useLang } from "../i18n";
import { useGame } from "../game/store";
import { chirp, play } from "../game/sound";
import { followClock, setAmbience } from "../game/music";
import { useReminders } from "../game/reminders";
import { RemindersPanel } from "./Reminders";
import { DecorBar } from "./DecorBar";
import { BadgeShelf, BadgeToast } from "./Badges";
import { type DayPhase, RoomScene, weatherFor } from "../scene/RoomScene";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Hatch } from "./Hatch";
import { Actions, Meters, TabBar, ThinkStrip, ToastView, TopBar, VoiceBubble, type Tab } from "./parts";
import { useVoice } from "../game/voice";
import { EvolutionChart, MeSheetBody, MindPanel, Sheet } from "./Sheets";
import { BagPanel, MapPanel, QuestPanel, noticeText } from "./WorldPanels";
import { useWorld } from "../game/world";
import { useChain } from "../game/chain";
import { liveAvailable, playerId, useLive, visitingFrom } from "../game/live";
import { InvitePanel, SocialBar } from "./Social";
import { type Action, CHARACTER_IN_ROOM, HOME, INDOOR_ROOMS, ROOMS, decorOf, neighbours } from "@lingxi/world";
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
import { ArenaPanel } from "./Arena";
import { BrainView } from "./BrainView";
import { ChainPanel } from "./ChainPanel";
import { HomePanel } from "./Home";
import { WardrobePanel } from "./Wardrobe";
import { MailboxPanel } from "./Mailbox";
import { AlbumPanel } from "./Album";
import { FriendsPanel } from "./Friends";
import { HoldersPanel } from "./Holders";
import { RIG_HOME_BGS, useHoldings } from "../game/holders";
import { bondName, bondsOf, friendKey, useFriends } from "../game/friends";
import { unreadCount, useMail } from "../game/mail";
import { Outings } from "./Outings";
import { DESTINATION, outfitOf } from "@lingxi/world";
import { Icon } from "./icons";
import { Sprite } from "./Sprite";
import "./play.css";

function phaseNow(): DayPhase {
  const t = timeOfDay(new Date().getHours());
  return t === 0 ? "night" : t === 3 ? "evening" : "day";
}

function drawnStage(s: string): PetStage {
  return s === "elder" ? "adult" : (s as PetStage);
}

/** When each visiting relative said hello this hour, so the greeting shows once on arrival. */
const KIN_HELLO: Record<string, number> = {};
const KIN_SEEN = new Set<string>();

export function PlayApp() {
  const { pet, toast, daily, lastCare, hatch, act, tick, wakeUp, say } = useGame();
  const t = useT();
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<Tab>("home");
  const [phase, setPhase] = useState<DayPhase>(phaseNow);
  const [circuit, setCircuit] = useState(false);
  const worldRoom = useWorld((s) => s.world.room);
  const worldFull = useWorld((s) => s.world);
  const travelling = !!worldFull.trip;
  const mailState = useMail();
  const unread = unreadCount(mailState);
  useEffect(() => {
    if (!mailState.loaded) void mailState.fetch();
  }, [mailState.loaded, mailState.fetch]);
  const homeDecor = useLive((s) => s.homeDecor);
  const placedDecor = decorOf(worldFull).placed;
  // our home's decorations live on the server too, so friends who drop by see them
  useEffect(() => {
    if (liveAvailable()) useLive.getState().shareDecor(placedDecor);
  }, [placedDecor]);
  const worldNotice = useWorld((s) => s.notice);
  const worldMove = useWorld((s) => s.move);
  const worldForage = useWorld((s) => s.forage);
  const [worldMsg, setWorldMsg] = useState<{ id: number; text: string } | null>(null);
  useEffect(followClock, []);
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
  useEffect(() => {
    if (!worldNotice) return;
    const text = noticeText(worldNotice, t, lang);
    if (!text) return;
    setWorldMsg({ id: worldNotice.id, text });
    const id = setTimeout(() => setWorldMsg(null), 2800);
    return () => clearTimeout(id);
    // the notice id changes on every event; t and lang only matter at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldNotice]);
  const room = ROOMS[worldRoom] ?? ROOMS[HOME]!;
  // X2: a rig holder's own home wears the rig-bay skin (a friend's home keeps its own look)
  const rigSkin = useHoldings((s) => !!s.held?.rig && s.skinOn);
  // what the room sounds like: rain outdoors on a rainy day, else birds by day and crickets at night
  const outdoors = !INDOOR_ROOMS.has(worldRoom);
  useEffect(() => {
    setAmbience(outdoors && weatherFor(new Date()) === "rain" ? "rain" : !outdoors ? "quiet" : phase === "night" ? "crickets" : phase === "day" ? "birds" : "quiet");
    return () => setAmbience("quiet");
  }, [outdoors, phase]);
  const who = CHARACTER_IN_ROOM[worldRoom] ?? null;
  const [talking, setTalking] = useState(false);
  const [npcFace, setNpcFace] = useState<string | null>(null);
  useEffect(() => {
    setTalking(false);
    setNpcFace(null);
  }, [worldRoom]);
  const [visiting, setVisiting] = useState<string | null>(() => visitingFrom());
  const revealAll = useReveal((s) => s.all);
  const [lockedAsk, setLockedAsk] = useState<Gated | null>(null);
  // decorating the home: null when not decorating, else the piece in hand ("" for none yet)
  const [decorating, setDecorating] = useState<string | null>(null);
  const others = useLive((s) => s.members);
  const roster = useGame((s) => s.pets);
  const [hourNow, setHourNow] = useState(() => Math.floor(Date.now() / 3_600_000));
  const liveConnect = useLive((s) => s.connect);
  const liveMood = useLive((s) => s.mood);
  const liveEmote = useLive((s) => s.emote);
  const incoming = useLive((s) => s.incoming);
  const liveShare = useLive((s) => s.shareCard);
  const liveAsk = useLive((s) => s.ask);
  const livePropose = useLive((s) => s.propose);
  const meet = useFriends((s) => s.meet);
  const friendsAll = useFriends((s) => s.all);
  const levelUp = useFriends((s) => s.levelUp);
  useEffect(() => {
    if (!levelUp) return;
    play("success");
    setWorldMsg({ id: levelUp.at, text: lang === "zh" ? `${useGame.getState().pet?.name ?? ""}和${levelUp.name}成了${bondName(levelUp.level, "zh")}！` : `${useGame.getState().pet?.name ?? "Your pet"} and ${levelUp.name} are now ${bondName(levelUp.level, "en").toLowerCase()}!` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelUp]);
  // ten minutes in the same room together is a moment shared with each pet there
  useEffect(() => {
    const id = setInterval(() => {
      for (const m of Object.values(useLive.getState().members)) meet(m.id, { name: m.name, line: m.line }, "together");
    }, 10 * 60_000);
    return () => clearInterval(id);
  }, [meet]);
  const petCount = useGame((s) => s.pets.length);
  const card = useLive((s) => s.card);
  const asked = useLive((s) => s.asked);
  const [picked, setPicked] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Partner | null>(null);
  const [duel, setDuel] = useState<Challenge | null>(null);
  useEffect(() => {
    if (pet) liveShare(petCard(pet));
  }, [pet?.lessons, pet?.family, pet?.brain, liveShare]);
  useEffect(() => {
    if (!card) return;
    const partner = friendPartner(card);
    if (!partner) {
      setWorldMsg({ id: Math.round(card.at), text: lang === "zh" ? "没法和这只宠物切磋" : "Can't spar with that pet" });
      return;
    }
    setChallenge(partner);
    setTab("spar");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);
  useEffect(() => {
    if (!asked) return;
    setWorldMsg({ id: Math.round(asked.at), text: lang === "zh" ? `${asked.name}和${useGame.getState().pet?.name ?? ""}切磋了一场` : `${asked.name} sparred with ${useGame.getState().pet?.name ?? "your pet"}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const space = worldRoom === HOME ? `home:${visiting ?? playerId()}` : `room:${worldRoom}`;
  useEffect(() => {
    if (worldRoom !== HOME && visiting) {
      setVisiting(null);
      history.replaceState(null, "", location.pathname);
    }
  }, [worldRoom, visiting]);
  useEffect(() => {
    const p = useGame.getState().pet;
    if (!p || !liveAvailable()) return;
    liveConnect({ name: p.name, line: p.line, stage: stageOf(p, Date.now()), mood: p.last.mood }, space);
  }, [space, liveConnect, pet?.name]);
  useEffect(() => {
    if (pet) liveMood(pet.last.mood);
  }, [pet?.last.mood, liveMood]);
  useEffect(() => {
    if (!incoming) return;
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
    setWorldMsg({ id: Math.round(incoming.at), text: lang === "zh" ? `${who}${v[1]}` : `${who} ${v[0]}` });
    // only react to a new incoming emote
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  // one live beat a minute while the app is open; catch up on return
  useEffect(() => {
    const id = setInterval(() => {
      tick();
      setPhase(phaseNow());
      setHourNow(Math.floor(Date.now() / 3_600_000));
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

  const stage = pet ? drawnStage(stageOf(pet, Date.now())) : "baby";
  const face = useMemo(() => (pet ? drawPet(pet.line, stage, { expression: "happy", ...(pet.form ? { form: pet.form } : {}) }) : null), [pet?.line, stage, pet?.form]);

  // say so when a relative arrives (once per visit); the visitors themselves are drawn in the room
  const kinArrivals = pet && worldRoom === HOME && !visiting ? visitorsNow(pet, roster, hourNow).map((k) => k.pet.name).join(", ") : "";
  useEffect(() => {
    if (!kinArrivals || !pet) return;
    const seen = `${hourNow}:${pet.bornAt}:${kinArrivals}`;
    if (KIN_SEEN.has(seen)) return;
    KIN_SEEN.add(seen);
    setWorldMsg({ id: Date.now(), text: lang === "zh" ? `${kinArrivals}来看${pet.name}了。` : `${kinArrivals} dropped by to see ${pet.name}.` });
  }, [kinArrivals]);

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
          stage: stageOf(k.pet, Date.now()),
          mood: 2,
          who: lang === "zh" ? `${pet.name}的${KIN_WORD[k.kin].zh}，从你的宠物里过来串门。` : `${pet.name}'s ${KIN_WORD[k.kin].en}, dropping by from your other pets.`,
          // a hello when they arrive this hour
          say: { text: lang === "zh" ? `来看看${pet.name}！` : `Came to see ${pet.name}!`, at: (KIN_HELLO[`${hourNow}:${k.pet.bornAt}`] ??= performance.now() + i * 400) },
        }))
      : [];
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
        <section className="stage" aria-label={pet.name}>
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
            others={[...Object.values(others), ...kinVisitors]}
            onOtherTap={(id) => (play("tap"), setPicked(id))}
            npc={who ? (talking && npcFace ? npcFace : who.stand) : null}
            onNpcTap={() => (play("tap"), setPicked(null), setTalking(true))}
          />
          <div className="room-pill">
            <b>{visiting && worldRoom === HOME ? (lang === "zh" ? "朋友家" : "A friend's home") : room.name[lang]}</b>
            {who && !talking && (
              <button type="button" onClick={() => (play("tap"), setTalking(true))}>
                {lang === "zh" ? `和${who.name.zh}说话` : `Talk to ${who.name.en}`}
              </button>
            )}
            {room.drops.length > 0 && (
              <button type="button" onClick={() => (play("tap"), worldForage())}>
                {t("room.look")}
              </button>
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
          <ToastView toast={toast} name={pet.name} />
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
                  if (block) return setWorldMsg({ id: Date.now(), text: block });
                  play("tap");
                  livePropose(other.id, useChain.getState().infoOf(pet) ?? undefined);
                  setWorldMsg({ id: Date.now(), text: lang === "zh" ? `问过${other.name}的主人了，等回复……` : `Asked ${other.name}'s owner. Waiting for an answer…` });
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
          {talking ? null : Object.keys(others).length > 0 ? <SocialBar count={Object.keys(others).length} /> : <ThinkStrip pet={pet} />}
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
          setDuel(c);
          pick("spar", true);
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
        <QuestPanel />
      </Sheet>
      <Sheet open={tab === "mind"} title={t("teach.title", { name: pet.name })} onClose={close}>
        <TeachPanel pet={pet} />
        <hr className="divider" />
        <p className="small">{t("mind.title", { name: pet.name })}</p>
        <MindPanel pet={pet} />
      </Sheet>

      <Sheet open={tab === "spar"} title={lang === "zh" ? "切磋" : "Spar"} onClose={close}>
        <ArenaPanel pet={pet} challenge={challenge} onChallengeTaken={() => setChallenge(null)} duel={duel} onDuelTaken={() => setDuel(null)} />
      </Sheet>

      <Sheet open={tab === "games"} title={lang === "zh" ? "一起玩" : "Play together"} onClose={close}>
        <GamesPanel pet={pet} onDone={close} onSchool={() => pick("mind")} />
      </Sheet>

      <Sheet open={tab === "pets"} title={lang === "zh" ? "你的宠物" : "Your pets"} onClose={close}>
        <PetsPanel onPicked={close} />
      </Sheet>

      <BadgeToast />
      <Sheet open={tab === "me"} title={t("me.title", { name: pet.name })} onClose={close}>
        <WardrobePanel pet={pet} />
        <hr className="divider" />
        <FriendsPanel pet={pet} />
        <hr className="divider" />
        <HoldersPanel />
        <hr className="divider" />
        <AlbumPanel />
        <hr className="divider" />
        <MeSheetBody pet={pet} />
        <hr className="divider" />
        <DiaryPanel pet={pet} />
        <hr className="divider" />
        <RewindPanel pet={pet} />
        <hr className="divider" />
        <EvolutionChart pet={pet} />
        <hr className="divider" />
        <FamilyTree pet={pet} />
        <hr className="divider" />
        <InvitePanel />
        <hr className="divider" />
        <SitPanel pet={pet} />
        <hr className="divider" />
        <OnChainNote lang={lang} />
        <hr className="divider" />
        <SendGiftPanel pet={pet} />
        <hr className="divider" />
        <RedPacketPanel pet={pet} />
        <hr className="divider" />
        <BadgeShelf />
        <hr className="divider" />
        <RemindersPanel pet={pet} />
        <hr className="divider" />
        <ChainPanel pet={pet} />
        <hr className="divider" />
        <HomePanel pet={pet} />
      </Sheet>
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
