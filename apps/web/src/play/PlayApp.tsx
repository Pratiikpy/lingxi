/** The game: hatch on first visit, then the pet's room with care, mind, spar and profile. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { boundingBox, drawPet } from "@lingxi/art";
import { STARTERS, timeOfDay } from "@lingxi/brain";
import { stageOf } from "@lingxi/game";
import { useT, useLang } from "../i18n";
import { useGame } from "../game/store";
import { chirp, play } from "../game/sound";
import { type DayPhase, RoomScene } from "../scene/RoomScene";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { Hatch } from "./Hatch";
import { Actions, Meters, TabBar, ThinkStrip, ToastView, TopBar, type Tab } from "./parts";
import { FoodList, MeSheetBody, MindPanel, Sheet } from "./Sheets";
import { TeachPanel } from "./Teach";
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
  }, [act, say]);

  const stage = pet ? drawnStage(stageOf(pet, Date.now())) : "baby";
  const face = useMemo(() => (pet ? drawPet("gentle", stage, { expression: "happy" }) : null), [pet?.line, stage]);

  if (!pet) {
    return (
      <Hatch
        onHatch={(line, name) => {
          hatch(line, name);
          play("success");
        }}
      />
    );
  }

  const feed = (food: string) => {
    close();
    play("pop");
    act({ kind: "feed", food });
  };
  const playBall = () => {
    play("pop");
    act({ kind: "play" });
  };
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
      <TopBar pet={pet} daily={daily} face={face && <FaceSprite canvas={face} line={pet.line} />} />
      <div className="main">
        <section className="stage" aria-label={pet.name}>
          <RoomScene
            line={pet.line}
            stage={stage}
            asleep={pet.asleep}
            want={pet.last.want}
            mood={pet.last.mood}
            phase={phase}
            lastCare={lastCare}
            onPetTap={onPetTap}
            reduceMotion={reduce}
          />
          <ToastView toast={toast} name={pet.name} />
          <ThinkStrip pet={pet} />
        </section>
        <div className="side">
          <Meters pet={pet} />
          <Actions pet={pet} onFeed={() => pick("care")} onPlay={playBall} onClean={clean} onSleep={sleep} />
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

      <Sheet open={tab === "care"} title={t("care.title", { name: pet.name })} onClose={close}>
        <FoodList pet={pet} onPick={feed} />
      </Sheet>
      <Sheet open={tab === "mind"} title={t("teach.title", { name: pet.name })} onClose={close}>
        <TeachPanel pet={pet} />
        <hr className="divider" />
        <p className="small">{t("mind.title", { name: pet.name })}</p>
        <MindPanel pet={pet} />
      </Sheet>
      <Sheet open={tab === "spar"} title={t("spar.title")} onClose={close}>
        <p className="small">{t("spar.locked", { name: pet.name })}</p>
        <div className="locked" aria-hidden="true">
          <div className="slot">???</div>
          <div className="slot">???</div>
          <div className="slot">???</div>
        </div>
      </Sheet>
      <Sheet open={tab === "me"} title={t("me.title", { name: pet.name })} onClose={close}>
        <MeSheetBody pet={pet} />
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
