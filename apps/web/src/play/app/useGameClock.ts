/**
 * P7: the game's clock while it is open, out of PlayApp. One live beat every few seconds (the store keeps a minute a
 * beat), caught up when the page comes back into view; the time of day and the hour that the room and its visitors
 * follow; what the room sounds like (rain outdoors on a rainy day, else birds by day and crickets at night); and the
 * care toast's few seconds on screen.
 */
import { useEffect, useState } from "react";
import { INDOOR_ROOMS } from "@lingxi/world";
import { now } from "../../game/gameClock";
import { setAmbience } from "../../game/music";
import { useGame } from "../../game/store";
import { type DayPhase, phaseNow } from "../../scene/dayPhase";
import { weatherFor } from "../../scene/weather";

/** how often the open game beats; the store decides how many minutes have passed */
const BEAT_MS = 5_000;
/** how long a care toast stays */
const TOAST_MS = 2600;

export function useGameClock(worldRoom: number): { phase: DayPhase; hourNow: number } {
  const tick = useGame((s) => s.tick);
  const wakeUp = useGame((s) => s.wakeUp);
  const toast = useGame((s) => s.toast);
  const [phase, setPhase] = useState<DayPhase>(phaseNow);
  const [hourNow, setHourNow] = useState(() => Math.floor(now() / 3_600_000));

  // what the room sounds like: rain outdoors on a rainy day, else birds by day and crickets at night
  const outdoors = !INDOOR_ROOMS.has(worldRoom);
  useEffect(() => {
    setAmbience(
      outdoors && weatherFor(new Date(now())) === "rain"
        ? "rain"
        : !outdoors
          ? "quiet"
          : phase === "night"
            ? "crickets"
            : phase === "day"
              ? "birds"
              : "quiet",
    );
    return () => setAmbience("quiet");
  }, [outdoors, phase]);

  // one live beat a minute while the app is open; catch up on return
  useEffect(() => {
    const id = setInterval(() => {
      tick();
      setPhase(phaseNow());
      setHourNow(Math.floor(now() / 3_600_000));
    }, BEAT_MS);
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
    const id = setTimeout(() => useGame.setState({ toast: null }), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { phase, hourNow };
}
