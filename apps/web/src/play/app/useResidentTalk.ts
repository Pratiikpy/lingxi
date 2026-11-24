/**
 * P7: who the pet can talk to in the room, out of PlayApp. The room's resident, or a resident visiting the home (plan
 * 4.3); the mark over their head (a quest to hand in, one to offer, a visitor waiting or a friendship step open); the
 * face they show while they talk; and the conversation ending when the room changes.
 */
import { useMemo, useState } from "react";
import { CHARACTERS, CHARACTER_IN_ROOM, FRIEND_BY_ID, HOME, openSteps, visitorOf } from "@lingxi/world";
import { questsOf, useQuestStatuses } from "../../game/quests";
import { play } from "../../game/sound";
import { useWorld } from "../../game/world";

type Character = (typeof CHARACTERS)[number];

export interface ResidentTalk {
  /** who stands in the room to talk to, if anyone */
  who: Character | null;
  /** a resident visiting the home, until met */
  visitor: Character | null;
  /** whoever was visiting when the talk began: they stay until it ends */
  guest: Character | null;
  talking: boolean;
  setTalking: (on: boolean) => void;
  startTalk: () => void;
  npcMark: "!" | "✓" | "★" | null;
  npcFace: string | null;
  setNpcFace: (face: string | null) => void;
  questStatuses: ReturnType<typeof useQuestStatuses>;
}

export function useResidentTalk(worldRoom: number): ResidentTalk {
  const worldState = useWorld((s) => s.world);
  const [talking, setTalking] = useState(false);
  // a resident who has come to visit stands in your home until you meet them (plan 4.3)
  const visitorId = worldRoom === HOME ? visitorOf(worldState) : null;
  const visitor = visitorId ? (CHARACTERS.find((c) => c.id === visitorId) ?? null) : null;
  // meeting them sends them home, but not mid-sentence: whoever was visiting when the talk began stays until it ends
  const [guest, setGuest] = useState<Character | null>(null);
  const startTalk = () => {
    play("tap");
    setGuest(visitor);
    setTalking(true);
  };
  const who = CHARACTER_IN_ROOM[worldRoom] ?? visitor ?? (talking && worldRoom === HOME ? guest : null);
  const questStatuses = useQuestStatuses();
  // over the resident's head: a quest to hand in, or one to offer; then a visitor waiting, or a friendship step open
  const npcMark = useMemo<"!" | "✓" | "★" | null>(() => {
    if (!who) return null;
    const q = questsOf(who.id, questStatuses);
    const friend = FRIEND_BY_ID[who.id];
    return q.ready.length
      ? "✓"
      : q.offer.length
        ? "!"
        : who === visitor || (friend && openSteps(worldState, friend).length)
          ? "★"
          : null;
  }, [who, questStatuses, visitor, worldState]);
  const [npcFace, setNpcFace] = useState<string | null>(null);
  // leaving a room ends a conversation in it
  const [talkRoom, setTalkRoom] = useState(worldRoom);
  if (talkRoom !== worldRoom) {
    setTalkRoom(worldRoom);
    setTalking(false);
    setNpcFace(null);
  }
  return { who, visitor, guest, talking, setTalking, startTalk, npcMark, npcFace, setNpcFace, questStatuses };
}
