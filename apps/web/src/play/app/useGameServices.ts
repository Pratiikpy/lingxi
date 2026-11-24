/**
 * P7: the work the game keeps running in the background while it is open, out of PlayApp so each piece reads as its
 * own: the letters' inbox, the panels' code warmed in idle moments, dialogs keeping the keyboard's focus, the clock,
 * what the wallets hold on chain, the pet's voice, reminders, auto-save, the mail, and the home's decorations shared
 * with visitors. Each reads what it needs from the stores; none holds state of the game screen.
 */
import { useEffect } from "react";
import { decorOf } from "@lingxi/world";
import { useLang } from "../../i18n";
import { recordOf, useChain } from "../../game/chain";
import { syncChainPieces } from "../../game/chainDecor";
import { loadColours, syncPacks } from "../../game/extras";
import { watchLetters } from "../../game/letters";
import { liveAvailable, useLive } from "../../game/live";
import { useMail } from "../../game/mail";
import { followClock } from "../../game/music";
import { useReminders } from "../../game/reminders";
import { useGame } from "../../game/store";
import { useVoice } from "../../game/voice";
import { useWorld } from "../../game/world";
import { warmDeferred } from "../Lazy";
import { installModalFocus } from "../modalFocus";

export function useGameServices(): void {
  // pet letters (H13): friends' addresses from the room, and the inbox read while the game is open
  useEffect(() => watchLetters(), []);
  // P3: the panels' code arrives in idle moments once the game is up, so a tap opens them at once
  useEffect(() => warmDeferred(), []);
  // P5: every dialog keeps the keyboard's focus while it is open, and gives it back when it closes
  useEffect(() => installModalFocus(), []);
  useEffect(followClock, []);

  // the mail, once
  const mailLoaded = useMail((s) => s.loaded);
  const fetchMail = useMail((s) => s.fetch);
  useEffect(() => {
    if (!mailLoaded) void fetchMail();
  }, [mailLoaded, fetchMail]);

  // our home's decorations live on the server too, so friends who drop by see them
  const world = useWorld((s) => s.world);
  const placedDecor = decorOf(world).placed;
  useEffect(() => {
    if (liveAvailable()) useLive.getState().shareDecor(placedDecor);
  }, [placedDecor]);

  // on-chain decorations and limited outfits the wallets hold (plans 4.6, 4.9): read on start, so a piece sold
  // elsewhere leaves the home; then the extras packs and the name colours of the pets on this device
  useEffect(() => {
    void syncChainPieces();
    void syncPacks();
    void loadColours(
      useGame
        .getState()
        .pets.map((p) => recordOf(p)?.petId ?? "")
        .filter(Boolean),
    );
  }, []);

  // the pet says something when its circuit makes a new decision
  const decision = useGame((s) => (s.pet ? `${s.pet.last.rule}|${s.pet.asleep}|${Boolean(s.pet.sick)}` : ""));
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
}
