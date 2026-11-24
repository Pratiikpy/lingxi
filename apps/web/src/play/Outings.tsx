/**
 * Going out (PRD W4, W5): a 20-minute walk that counts real steps where the
 * phone can, and trips that take the pet away for a few hours and bring back
 * things and recipes. Shown at the top of the map.
 */

import { useEffect, useState } from "react";
import {
  DESTINATIONS,
  DESTINATION,
  ITEM,
  STEPS_PER_FIND,
  TRAVEL_RECIPES,
  WALK_MINUTES,
  tripBack,
  walkDone,
  walkSteps,
} from "@lingxi/world";
import type { Pet } from "@lingxi/game";
import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { allowMotion, countSteps, probeMotion } from "../game/steps";
import { play } from "../game/sound";
import { itemList } from "../game/noticeText";
import { now as gameNow } from "../game/gameClock";

function clock(ms: number, lang: string): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  return lang === "zh" ? (h ? `${h} 小时 ${m % 60} 分` : `${m} 分钟`) : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function Outings({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { world, startWalk, addSteps, endWalk, startTrip, endTrip, lastOuting } = useWorld();
  const [tick, setNow] = useState(gameNow());
  // never behind the walk's own start, so the first second cannot show negative steps
  const now = Math.max(tick, world.walk?.startedAt ?? 0);
  const [starting, setStarting] = useState(false);
  const walk = world.walk;
  const trip = world.trip;
  useEffect(() => {
    const id = setInterval(() => setNow(gameNow()), walk ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [walk]);
  // steps from the motion sensor while the walk is on screen
  useEffect(() => {
    if (!walk?.sensor) return;
    return countSteps((n) => addSteps(n));
  }, [walk?.sensor, walk?.startedAt, addSteps]);
  // a finished walk settles itself
  useEffect(() => {
    if (walk && walkDone(walk, now)) endWalk();
  }, [walk, now, endWalk]);

  const begin = async () => {
    setStarting(true);
    play("tap");
    const sensor = (await allowMotion()) && (await probeMotion());
    startWalk(sensor);
    setStarting(false);
  };

  const steps = walk ? walkSteps(walk, now) : 0;
  const found = walk ? walk.finds.reduce((t, f) => t + f.n, 0) : 0;
  const tooTired = pet.asleep || pet.meters.energy / 60 < 150;

  return (
    <section className="outings" aria-label={L("Going out", "出门")}>
      {lastOuting && (
        <div className="outing-done" role="status">
          {lastOuting.kind === "walk" ? (
            <p>
              {L(
                `Back from a walk: ${lastOuting.steps.toLocaleString("en")} steps in ${lastOuting.minutes} minutes.`,
                `散步回来了：${lastOuting.minutes} 分钟，${lastOuting.steps.toLocaleString("zh-CN")} 步。`,
              )}{" "}
              {lastOuting.found.length
                ? L(`Found ${itemList(lastOuting.found, lang)}.`, `找到了${itemList(lastOuting.found, lang)}。`)
                : lastOuting.capped
                  ? L(
                      "Nothing new this time: the first two walks of a day turn things up.",
                      "这次没找到新东西：每天前两次散步才会有收获。",
                    )
                  : L(
                      `Too short to find anything: something turns up every ${STEPS_PER_FIND} steps. A walk this short doesn't use up one of today's two.`,
                      `走得太短，什么也没找到：每 ${STEPS_PER_FIND} 步才会找到一样。这么短的散步不算在今天的两次里。`,
                    )}
            </p>
          ) : (
            <>
              <p className="outing-postcard">“{DESTINATION[lastOuting.to]!.postcard[lang]}”</p>
              <p>
                {L(
                  `${pet.name} is home from ${DESTINATION[lastOuting.to]!.name.en.toLowerCase()} with ${itemList(lastOuting.found, lang)}.`,
                  `${pet.name}从${DESTINATION[lastOuting.to]!.name.zh}回来了，带回${itemList(lastOuting.found, lang)}。`,
                )}
                {lastOuting.learned
                  ? L(
                      ` It also learned a recipe: ${TRAVEL_RECIPES.find((r) => r.index === lastOuting.learned)!.name.en}. Find it at the workbench.`,
                      ` 还学会了一道菜谱：${TRAVEL_RECIPES.find((r) => r.index === lastOuting.learned)!.name.zh}，去工作台看看。`,
                    )
                  : ""}
              </p>
            </>
          )}
        </div>
      )}
      {walk ? (
        <div className="outing-card is-walking">
          <p className="label">{L("On a walk", "正在散步")}</p>
          <p className="outing-steps">
            <b>{steps.toLocaleString(lang === "zh" ? "zh-CN" : "en")}</b>{" "}
            {walk.sensor
              ? L("steps", "步")
              : L("steps (from minutes: this device has no step sensor)", "步（按分钟算：这台设备没有计步传感器）")}
          </p>
          <div
            className="outing-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={WALK_MINUTES}
            aria-valuenow={Math.min(WALK_MINUTES, Math.floor((now - walk.startedAt) / 60_000))}
          >
            <i style={{ transform: `scaleX(${Math.min(1, (now - walk.startedAt) / (WALK_MINUTES * 60_000))})` }} />
          </div>
          <p className="small">
            {L(
              `${clock(walk.startedAt + WALK_MINUTES * 60_000 - now, lang)} to go · found ${found} so far · one find every ${STEPS_PER_FIND} steps`,
              `还剩 ${clock(walk.startedAt + WALK_MINUTES * 60_000 - now, lang)} · 已找到 ${found} 样 · 每 ${STEPS_PER_FIND} 步找到一样`,
            )}
          </p>
          <button type="button" className="btn" onClick={() => (play("tap"), endWalk())}>
            {L("Head home now", "现在回家")}
          </button>
        </div>
      ) : trip ? (
        <div className="outing-card is-away">
          <p className="label">{L("Away on a trip", "出门旅行中")}</p>
          <p>
            {L(
              `${pet.name} is at ${DESTINATION[trip.to]!.name.en.toLowerCase()}.`,
              `${pet.name}在${DESTINATION[trip.to]!.name.zh}。`,
            )}
          </p>
          {tripBack(trip, now) ? (
            <button type="button" className="btn primary" onClick={() => (play("success"), endTrip())}>
              {L(`Welcome ${pet.name} home`, `欢迎${pet.name}回家`)}
            </button>
          ) : (
            <p className="small">
              {L(`Back in ${clock(trip.backAt - now, lang)}.`, `${clock(trip.backAt - now, lang)}后回来。`)}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="outing-card">
            <p className="label">{L("Go for a walk", "去散步")}</p>
            <p className="small">
              {L(
                `${WALK_MINUTES} minutes together. On a phone, your real steps count; ${pet.name} finds something every ${STEPS_PER_FIND} steps (the first two walks a day).`,
                `一起走 ${WALK_MINUTES} 分钟。用手机时按你真实的步数算；每 ${STEPS_PER_FIND} 步${pet.name}会找到一样东西（每天前两次散步）。`,
              )}
            </p>
            <button type="button" className="btn primary" disabled={starting || tooTired} onClick={() => void begin()}>
              {starting
                ? L("Getting ready…", "准备中……")
                : tooTired
                  ? L("Too tired to walk", "太累了，走不动")
                  : L("Start walking", "出发散步")}
            </button>
          </div>
          <div className="outing-card">
            <p className="label">{L("Send it on a trip", "送它去旅行")}</p>
            <p className="small">
              {L(
                `${pet.name} goes for a few hours and comes back with things you can't find here, and a recipe the first time.`,
                `${pet.name}出门几个小时，带回这里找不到的东西，第一次去还会学会一道菜谱。`,
              )}
            </p>
            <ul className="outing-places">
              {DESTINATIONS.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="outing-place"
                    disabled={tooTired}
                    onClick={() => (play("tap"), startTrip(d.id))}
                  >
                    <b>{d.name[lang]}</b>
                    <span className="small">
                      {L(`${d.hours} hours`, `${d.hours} 小时`)} ·{" "}
                      {d.drops
                        .map((x) => ITEM[x.item]!.name[lang])
                        .slice(0, 3)
                        .join(lang === "zh" ? "、" : ", ")}
                      {(world.recipes ?? []).includes(d.teaches) ? "" : L(" · a new recipe", " · 新菜谱")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
