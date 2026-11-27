/**
 * P7: the live room, out of PlayApp. Joining the room the pet is in (its space, its name, its chain id), sharing its
 * card every beat and its mood as it changes, and what other pets in the room do: a friend's card arriving opens a
 * spar, another pet sparring with it, an emote answered, ten minutes together remembered, a friendship that grows.
 */
import { useEffect, useEffectEvent } from "react";
import { friendPartner, petCard, stageOf } from "@lingxi/game";
import { useLang } from "../../i18n";
import { startFight } from "../../game/arenaFight";
import { useChain } from "../../game/chain";
import { bondName, useFriends } from "../../game/friends";
import { now } from "../../game/gameClock";
import { liveAvailable, useLive } from "../../game/live";
import { cannotSparText } from "../../game/liveCardWords";
import { play } from "../../game/sound";
import { useGame } from "../../game/store";
import { useWorldMessage } from "./worldMessage";

/** `space` is the room's live address; `openSpar` brings the spar screen up when a friend's card starts a fight. */
export function useLiveRoom(space: string, openSpar: () => void): void {
  const lang = useLang((s) => s.lang);
  const show = useWorldMessage((s) => s.show);
  const pet = useGame((s) => s.pet);
  const meet = useFriends((s) => s.meet);
  const liveConnect = useLive((s) => s.connect);
  const liveMood = useLive((s) => s.mood);
  const liveShare = useLive((s) => s.shareCard);

  // a friendship that grows says so
  const sayLevelUp = useEffectEvent((up: NonNullable<ReturnType<typeof useFriends.getState>["levelUp"]>) => {
    play("success");
    show({
      id: up.at,
      text:
        lang === "zh"
          ? `${useGame.getState().pet?.name ?? ""}和${up.name}成了${bondName(up.level, "zh")}！`
          : `${useGame.getState().pet?.name ?? "Your pet"} and ${up.name} are now ${bondName(up.level, "en").toLowerCase()}!`,
      ms: 4500,
    });
  });
  useEffect(
    () => useFriends.subscribe((s, before) => s.levelUp && s.levelUp !== before.levelUp && sayLevelUp(s.levelUp)),
    [],
  );

  // ten minutes in the same room together is a moment shared with each pet there
  useEffect(() => {
    const id = setInterval(() => {
      for (const m of Object.values(useLive.getState().members)) meet(m.id, { name: m.name, line: m.line }, "together");
    }, 10 * 60_000);
    return () => clearInterval(id);
  }, [meet]);

  // the card carries the pet's memory, which changes every beat; so does the pet: one share per beat, as before
  useEffect(() => {
    if (pet) liveShare(petCard(pet));
  }, [pet, liveShare]);

  // a friend's card arriving opens a spar against it, with the pet as it is then; one that cannot spar says so, in the
  // language of that moment
  const takeCard = useEffectEvent((card: NonNullable<ReturnType<typeof useLive.getState>["card"]>) => {
    const partner = card.unavailable ? null : friendPartner(card);
    const p = useGame.getState().pet;
    // a card the room could not keep is said to be unavailable for now, not a pet that cannot spar (P10)
    if (!partner || !p) return show({ id: Math.round(card.at), text: cannotSparText(card, lang), ms: 3500 });
    startFight(p, partner);
    openSpar();
  });
  useEffect(() => useLive.subscribe((s, before) => s.card && s.card !== before.card && takeCard(s.card)), []);

  const saySparred = useEffectEvent((by: NonNullable<ReturnType<typeof useLive.getState>["asked"]>) =>
    show({
      id: Math.round(by.at),
      text:
        lang === "zh"
          ? `${by.name}和${useGame.getState().pet?.name ?? ""}切磋了一场`
          : `${by.name} sparred with ${useGame.getState().pet?.name ?? "your pet"}`,
      ms: 4000,
    }),
  );
  useEffect(() => useLive.subscribe((s, before) => s.asked && s.asked !== before.asked && saySparred(s.asked)), []);

  // a room is joined again when the space, the pet's name or its chain id changes; it reads the rest fresh
  const chainPetId = useChain((s) => s.record?.petId);
  const petName = pet?.name;
  useEffect(() => {
    const p = useGame.getState().pet;
    if (!p || !liveAvailable()) return;
    liveConnect(
      {
        name: p.name,
        line: p.line,
        stage: stageOf(p, now()),
        mood: p.last.mood,
        ...(chainPetId ? { petId: chainPetId } : {}),
      },
      space,
    );
  }, [space, liveConnect, petName, chainPetId]);
  const mood = pet?.last.mood;
  useEffect(() => {
    if (mood !== undefined) liveMood(mood);
  }, [mood, liveMood]);

  // only a new incoming emote is answered; who sent it is read as the room is then
  const answerEmote = useEffectEvent((incoming: NonNullable<ReturnType<typeof useLive.getState>["incoming"]>) => {
    const others = useLive.getState().members;
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
    if (from)
      meet(
        from.id,
        { name: from.name, line: from.line },
        incoming.kind === "heart" ? "heart" : incoming.kind === "gift" ? "gift" : "wave",
      );
    show({ id: Math.round(incoming.at), text: lang === "zh" ? `${who}${v[1]}` : `${who} ${v[0]}`, ms: 3500 });
  });
  useEffect(
    () => useLive.subscribe((s, before) => s.incoming && s.incoming !== before.incoming && answerEmote(s.incoming)),
    [],
  );
}
