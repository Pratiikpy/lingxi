/**
 * P7: what the game does around its own screen, out of PlayApp: inside Telegram, its back button closes whichever
 * sheet is open (S11); the app icon shows how many things the pet needs (Y1); and a home-screen shortcut (Feed, Play,
 * Teach) opens straight onto its screen once there is a pet.
 */
import { useEffect, useState } from "react";
import type { Pet } from "@lingxi/game";
import { needsOf, showNeeds } from "../../game/badge";
import { useMove } from "../../game/move";
import { telegramBack } from "../../game/telegram";
import type { Tab } from "../parts";

export function useAppChrome(pet: Pet | null, tab: Tab, setTab: (t: Tab) => void): void {
  // S11: inside Telegram, its back button closes whichever sheet is open
  const moveAsk = useMove((s) => s.ask);
  useEffect(() => {
    telegramBack(moveAsk ? () => useMove.getState().closeOffer() : tab === "home" ? null : () => setTab("home"));
  }, [tab, moveAsk, setTab]);

  // Y1: the app icon shows how many things the pet needs
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
}
