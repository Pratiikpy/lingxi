/**
 * P7: who drops by the room, out of PlayApp. Relatives on this device visit the home now and then (PRD G3), each with
 * a hello when it arrives this hour, and their arrival is said once a visit; at night something shy watches from the
 * Butterfly Forest's trees once it has been seen, and comes closer once it is a friend (Flit's story, quests 42 and 43).
 */
import { useEffect, useEffectEvent, useRef } from "react";
import { NIGHT } from "@lingxi/art";
import { type Pet, stageOf, visitorsNow } from "@lingxi/game";
import { HOME } from "@lingxi/world";
import { now } from "../../game/gameClock";
import type { DayPhase } from "../../scene/dayPhase";
import { SHY_ONE } from "../Album";
import { useWorldMessage } from "./worldMessage";

/** where Flit's shy visitor lives (room 56) */
export const BUTTERFLY_FOREST = 56;

/** When each visiting relative said hello this hour, so the greeting shows once on arrival. */
const KIN_HELLO: Record<string, number> = {};

const KIN_WORD = {
  parent: { en: "parent", zh: "爸爸妈妈" },
  child: { en: "little one", zh: "孩子" },
  sibling: { en: "sibling", zh: "兄弟姐妹" },
} as const;

export function useRoomVisitors({
  pet,
  roster,
  worldRoom,
  visiting,
  hourNow,
  phase,
  flags,
  lang,
}: {
  pet: Pet | null;
  roster: readonly Pet[];
  worldRoom: number;
  /** whose home this is, when it is a friend's */
  visiting: string | null;
  hourNow: number;
  phase: DayPhase;
  /** the world's story flags */
  flags: readonly string[];
  lang: "en" | "zh";
}) {
  const setWorldMsg = useWorldMessage((s) => s.show);
  const kin = pet && worldRoom === HOME && !visiting ? visitorsNow(pet, roster, hourNow) : [];

  // say so when a relative arrives (once per visit); the visitors themselves are drawn in the room
  const kinArrivals = kin.map((k) => k.pet.name).join(", ");
  // once per hour and set of visitors, whatever else changes
  const kinVisit = kinArrivals && pet ? `${hourNow}:${pet.bornAt}:${kinArrivals}` : "";
  // said after the render, never during it: the message lives in a store other components read (React refuses one
  // component's render updating another's, CI 2026-11-25)
  const kinSeen = useRef<Set<string>>(new Set());
  const sayKin = useEffectEvent((visit: string, who: string, name: string) => {
    setWorldMsg({
      id: visit,
      text: lang === "zh" ? `${who}来看${name}了。` : `${who} dropped by to see ${name}.`,
      ms: 4500,
    });
  });
  const petName = pet?.name ?? "";
  useEffect(() => {
    if (!kinVisit || kinSeen.current.has(kinVisit)) return;
    kinSeen.current.add(kinVisit);
    sayKin(kinVisit, kinArrivals, petName);
  }, [kinVisit, kinArrivals, petName]);

  const kinVisitors = pet
    ? kin.map((k, i) => ({
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

  // only at night, only in the forest, only after it has been seen
  const shyOne =
    worldRoom === BUTTERFLY_FOREST && phase === "night" && !visiting && flags.includes("shy-visitor")
      ? {
          id: "shy:one",
          name: flags.includes("shy-friend") ? SHY_ONE.name[lang] : lang === "zh" ? "某个害羞的家伙" : "Something shy",
          line: SHY_ONE.look.line,
          stage: SHY_ONE.look.stage,
          mood: flags.includes("shy-friend") ? 2 : 0,
          look: {
            palette: { key: "night", colors: NIGHT },
            outfitAt: () => ({}),
            x: flags.includes("shy-friend") ? 42 : 18,
          },
        }
      : null;

  return { kinVisitors, shyOne };
}
