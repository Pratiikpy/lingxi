/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { boundingBox, drawPet } from "@lingxi/art";
import { STARTERS, timeOfDay } from "@lingxi/brain";
import { type Partner, friendPartner, petCard, stageOf } from "@lingxi/game";
import { useT, useLang } from "../i18n";
import { useGame } from "../game/store";
import { chirp, play } from "../game/sound";
import { followClock } from "../game/music";
import { useReminders } from "../game/reminders";
import { RemindersPanel } from "./Reminders";
import { BadgeShelf, BadgeToast } from "./Badges";
import { type DayPhase, RoomScene } from "../scene/RoomScene";
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
import { type Action, CHARACTER_IN_ROOM, HOME, ROOMS, neighbours } from "@lingxi/world";
import { Talk } from "./Talk";
import { GamesPanel } from "./Games";
import { DiaryPanel } from "./Diary";
import { GiftArrival, SendGiftPanel } from "./Gift";
import { PacketArrival, RedPacketPanel } from "./RedPacket";
import { FamilyTree, NewbornDialog, PetsPanel, ProposalDialog, familyBlock } from "./Family";
import { AnimatePresence, motion } from "motion/react";
import { TeachPanel } from "./Teach";
import { ArenaPanel } from "./Arena";
import { BrainView } from "./BrainView";
import { ChainPanel } from "./ChainPanel";
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

export function PlayApp() {
  const { pet, toast, daily, lastCare, hatch, act, tick, wakeUp, say } = useGame();
  const t = useT();
  const lang = useLang((s) => s.lang);
  const reduce = useReducedMotion() ?? false;
  const [tab, setTab] = useState<Tab>("home");
  const [phase, setPhase] = useState<DayPhase>(phaseNow);
  const [circuit, setCircuit] = useState(false);
  const worldRoom = useWorld((s) => s.world.room);
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
  const who = CHARACTER_IN_ROOM[worldRoom] ?? null;
  const [talking, setTalking] = useState(false);
  const [npcFace, setNpcFace] = useState<string | null>(null);
  useEffect(() => {
    setTalking(false);
    setNpcFace(null);
  }, [worldRoom]);
  const [visiting, setVisiting] = useState<string | null>(() => visitingFrom());
  const others = useLive((s) => s.members);
  const liveConnect = useLive((s) => s.connect);
  const liveMood = useLive((s) => s.mood);
  const liveEmote = useLive((s) => s.emote);
  const incoming = useLive((s) => s.incoming);
  const liveShare = useLive((s) => s.shareCard);
  const liveAsk = useLive((s) => s.ask);
  const livePropose = useLive((s) => s.propose);
  const petCount = useGame((s) => s.pets.length);
  const card = useLive((s) => s.card);
  const asked = useLive((s) => s.asked);
  const [picked, setPicked] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Partner | null>(null);
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
  const face = useMemo(() => (pet ? drawPet("gentle", stage, { expression: "happy" }) : null), [pet?.line, stage]);

  if (!pet) {
    return (
      <>
        <Hatch
          onHatch={(line, name) => {
            hatch(line, name);
            play("success");
          }}
        />
        <GiftArrival />
        <PacketArrival />
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
  const pick = (next: Tab) => {
    play("tap");
    setTab(next === tab ? "home" : next);
  };

  return (
    <div className="app">
      <TopBar pet={pet} daily={daily} face={face && <FaceSprite canvas={face} line={pet.line} />} onQuests={() => pick("quests")} onPets={() => pick("pets")} petCount={petCount} />
      <div className="main">
        <section className="stage" aria-label={pet.name}>
          <RoomScene
            line={pet.line}
            stage={stage}
            asleep={pet.asleep}
            sick={!!pet.sick}
            want={pet.last.want}
            mood={pet.last.mood}
            phase={phase}
            lastCare={lastCare}
            onPetTap={onPetTap}
            reduceMotion={reduce}
            bgs={room.bgs}
            others={Object.values(others)}
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
            {room.index !== HOME && neighbours(room.index).includes(HOME) && (
              <button type="button" onClick={() => worldMove(HOME)}>
                {t("room.home")}
              </button>
            )}
          </div>
          {circuit && (
            <div className="circuit-overlay">
              <BrainView pet={pet} reduceMotion={reduce} />
            </div>
          )}
          <button type="button" className="circuit-btn" aria-pressed={circuit} aria-label={lang === "zh" ? "看它的电路" : "See its circuit"} onClick={() => (play("tap"), setCircuit((v) => !v))}>
            <Icon name="mind" size={22} />
          </button>
          <ToastView toast={toast} name={pet.name} />
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
          {picked && others[picked] && (
            <div className="visitor-card" role="dialog" aria-label={others[picked]!.name}>
              <b>{others[picked]!.name}</b>
              <button type="button" className="btn" onClick={() => (play("pop"), liveEmote("heart", picked), setPicked(null))}>
                <Icon name="heart" size={16} /> {lang === "zh" ? "送心" : "Heart"}
              </button>
              <button type="button" className="btn primary" onClick={() => (play("tap"), liveAsk(picked), setPicked(null))}>
                <Icon name="paw" size={16} /> {lang === "zh" ? "切磋" : "Spar"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const other = others[picked]!;
                  const block = familyBlock(pet, other.stage, lang);
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
          {!talking && <VoiceBubble />}
          {talking ? null : Object.keys(others).length > 0 ? <SocialBar count={Object.keys(others).length} /> : <ThinkStrip pet={pet} />}
        </section>
        <div className="side">
          <Meters pet={pet} />
          <Actions pet={pet} onFeed={() => pick("bag")} onPlay={playBall} onClean={clean} onSleep={sleep} onMedicine={() => (play("sparkle"), act({ kind: "medicine" }))} />
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
      <TabBar current={tab} onPick={pick} />
      <ProposalDialog pet={pet} />
      <GiftArrival />
      <PacketArrival />
      <NewbornDialog pet={pet} />

      <Sheet open={tab === "bag"} title={t("bag.title")} onClose={close}>
        <BagPanel onFed={close} />
      </Sheet>
      <Sheet open={tab === "map"} title={t("map.title")} onClose={close}>
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
        <ArenaPanel pet={pet} challenge={challenge} onChallengeTaken={() => setChallenge(null)} />
      </Sheet>

      <Sheet open={tab === "games"} title={lang === "zh" ? "一起玩" : "Play together"} onClose={close}>
        <GamesPanel pet={pet} onDone={close} />
      </Sheet>

      <Sheet open={tab === "pets"} title={lang === "zh" ? "你的宠物" : "Your pets"} onClose={close}>
        <PetsPanel onPicked={close} />
      </Sheet>

      <BadgeToast />
      <Sheet open={tab === "me"} title={t("me.title", { name: pet.name })} onClose={close}>
        <MeSheetBody pet={pet} />
        <hr className="divider" />
        <DiaryPanel pet={pet} />
        <hr className="divider" />
        <EvolutionChart pet={pet} />
        <hr className="divider" />
        <FamilyTree pet={pet} />
        <hr className="divider" />
        <InvitePanel />
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
