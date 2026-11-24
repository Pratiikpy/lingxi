/**
 * Pet-sitting screens (PRD C10, M2): sending a pet to a friend, the owner's
 * waiting card, the friend's arrival card, and sending it home.
 */

import { firstLine } from "../game/errorText";
import { atCentre } from "../game/adoption";
import { atHandheld } from "../game/handheld";
import { HandheldAwayCard } from "./Handheld";
import { CentreCard } from "./Adoption";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { drawPet } from "@lingxi/art";
import { type Pet, type SitPack, stageOf } from "@lingxi/game";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import {
  bringHomeNow,
  checkHome,
  collect,
  sendHome,
  sendToSitter,
  sitLink,
  sittingAvailable,
  takeIn,
} from "../game/sitting";
import { TooBig, sizeNote } from "../game/sendSize";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { Sprite } from "./Sprite";
import { now } from "../game/gameClock";
import { watchLinks } from "../game/linkWatch";

type Lang = "en" | "zh";
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : s === "egg" ? "baby" : (s as PetStage));
const day = (ms: number, lang: Lang) =>
  new Date(ms).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", { month: "long", day: "numeric" });

async function share(url: string, title: string) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else await navigator.clipboard.writeText(url);
  } catch {
    // dismissed; the link stays on screen
  }
}

/** The pet sheet's section: send it to a friend, or (for a guest) send it home. */
export function SitPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!sittingAvailable() || pet.away) return null;
  if (pet.sitting) {
    const s = pet.sitting;
    return (
      <div className="chainpanel sitpanel">
        <p className="label">{lang === "zh" ? "代人照看" : "Looking after a friend's pet"}</p>
        <p className="small">
          {lang === "zh"
            ? `${s.name}在你这里住到 ${day(s.until, lang)}。你可以照顾它、陪它玩、帮它存档，但只有它的主人能教它。`
            : `${s.name} is staying with you until ${day(s.until, lang)}. You can care for it, play and save it, but only its owner teaches it.`}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            play("tap");
            setBusy(true);
            const { ok, big } = await sendHome(pet).then(
              (sent) => ({ ok: sent, big: null }),
              (e: unknown) => ({ ok: false, big: e instanceof TooBig ? e : null }),
            );
            setBusy(false);
            setMsg(
              ok
                ? null
                : big
                  ? lang === "zh"
                    ? `${s.name}这次带回家的东西太多，发不出去${sizeNote(big, lang)}。什么都没有丢，它会留在你这里。`
                    : `${s.name} has too much to carry home this way ${sizeNote(big, lang)}. Nothing is lost; it stays with you for now.`
                  : lang === "zh"
                    ? "没送出去，请再试一次。"
                    : "It couldn't be sent home; please try again.",
            );
            if (ok) play("success");
          }}
        >
          {lang === "zh" ? `送${s.name}回家` : `Send ${s.name} home`}
        </button>
        {msg && <p className="small sp-warn">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="chainpanel sitpanel">
      <p className="label">{lang === "zh" ? "托朋友照看" : "Leave it with a friend"}</p>
      <p className="small">
        {lang === "zh"
          ? `要出门？把${pet.name}送去朋友那里住几天。朋友照顾它的每个念头都会带回来，你的游戏会逐一核对后才接它回家。`
          : `Going away? Send ${pet.name} to stay with a friend. Every thought it has there comes back with it, and your game checks them all before taking it home.`}
      </p>
      <div className="row">
        <select
          className="input"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label={lang === "zh" ? "天数" : "Days"}
        >
          {[1, 2, 3, 5, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              {lang === "zh" ? `${d} 天` : `${d} ${d === 1 ? "day" : "days"}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            play("tap");
            setBusy(true);
            try {
              const url = await sendToSitter(pet, days);
              await share(url, lang === "zh" ? `来照看${pet.name}` : `Look after ${pet.name}`);
              play("success");
            } catch (e) {
              setMsg(
                e instanceof TooBig
                  ? lang === "zh"
                    ? `${pet.name}的存档太大，送不到朋友那里${sizeNote(e, lang)}。什么都没有发出去，它还在你身边。`
                    : `${pet.name}'s save is too large to send to a friend ${sizeNote(e, lang)}. Nothing was sent; it is still with you.`
                  : // the server's own refusals, each said for what it is: trying again would not help (A50)
                    firstLine(e) === "tooMany"
                    ? lang === "zh"
                      ? "这个网络地址已经有 8 只宠物的存档放在朋友那里（照看结束后还会保留一周）。等最早的那份到期一周后再送吧。什么都没有发出去。"
                      : "This address already has 8 pets' saves waiting with friends (each is kept for a week after its sitting ends). Send this one once the oldest has been let go. Nothing was sent."
                    : firstLine(e) === "full"
                      ? lang === "zh"
                        ? "灵犀存放托人照看的宠物的空间暂时满了。什么都没有发出去，它还在你身边；过几天再试。"
                        : "Lingxi's shelf for pets with friends is full for now. Nothing was sent; it is still with you. Try again in a few days."
                      : firstLine(e) === "busy"
                        ? lang === "zh"
                          ? "这个网络地址这一小时送得太多了。什么都没有发出去；过一会儿再试。"
                          : "Too many sends from this address this hour. Nothing was sent; try again in a while."
                        : lang === "zh"
                          ? "没能送出，请再试一次。"
                          : "It couldn't be sent; please try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {lang === "zh" ? "送去朋友家" : "Send to a friend"}
        </button>
      </div>
      {msg && <p className="small sp-warn">{msg}</p>}
    </div>
  );
}

/** The owner's view while the pet is away: it waits here, frozen, until it comes home. */
export function AwayCard({ pet }: { pet: Pet }) {
  // a little one waiting at the adoption centre has its own card (plan 4.8)
  if (atCentre(pet)) return <CentreCard pet={pet} />;
  // a pet out on the handheld (plan 4.14)
  if (atHandheld(pet)) return <HandheldAwayCard pet={pet} />;
  return <FriendAwayCard pet={pet} />;
}

function FriendAwayCard({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const [state, setState] = useState<"idle" | "checking" | "waiting" | "refused" | "unreachable">(() =>
    pet.away?.code ? "checking" : "idle",
  );
  const away = pet.away;
  const settled = useCallback((r: Awaited<ReturnType<typeof checkHome>>) => {
    if (r === "home") play("success");
    else setState(r);
  }, []);
  const check = () => {
    setState("checking");
    return checkHome(pet).then(settled);
  };
  const code = away?.code;
  // a pet newly away is being looked for from the moment the screen shows it
  const [checkedFor, setCheckedFor] = useState(code);
  if (code !== checkedFor) {
    setCheckedFor(code);
    if (code) setState("checking");
  }
  // look for a return when the screen opens, and every few minutes, each time with the pet as it is then
  const checkPet = useEffectEvent(() => checkHome(pet));
  useEffect(() => {
    if (!code) return;
    void checkPet().then(settled);
    const id = setInterval(() => {
      setState("checking");
      void checkPet().then(settled);
    }, 5 * 60_000);
    return () => clearInterval(id);
  }, [code, settled]);
  if (!away) return null;
  const link = sitLink(away.code, away.key);
  return (
    <div className="away-card" role="status">
      <p className="label">{lang === "zh" ? "在朋友家" : "Staying with a friend"}</p>
      <p>
        {lang === "zh"
          ? `${pet.name}在朋友家住到 ${day(away.until, lang)}。它回来时，你的游戏会核对它在那里的每个念头。`
          : `${pet.name} is staying with a friend until ${day(away.until, lang)}. When it comes home, your game checks every thought it had there.`}
      </p>
      {state === "waiting" && <p className="small">{lang === "zh" ? "还没回来。" : "Not home yet."}</p>}
      {state === "refused" && (
        <p className="small sp-warn">
          {lang === "zh"
            ? "送回来的宠物没有通过核对（念头对不上），所以没有接收。"
            : "What came back didn't pass the check (its thoughts don't follow on from yours), so it wasn't taken in."}
        </p>
      )}
      {state === "unreachable" && (
        <p className="small">
          {lang === "zh" ? "暂时连不上，稍后再看。" : "Can't reach the server right now; try again soon."}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={state === "checking"}
          onClick={() => (play("tap"), void check())}
        >
          {lang === "zh" ? "看看回来没有" : "Is it home yet?"}
        </button>
        <button type="button" className="btn" onClick={() => (play("tap"), void share(link, pet.name))}>
          {lang === "zh" ? "再发一次链接" : "Share the link again"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            play("tap");
            await bringHomeNow(pet);
          }}
        >
          {lang === "zh" ? "现在接回家" : "Bring it home now"}
        </button>
      </div>
    </div>
  );
}

/** The friend's side: a pet arriving by link. */
export function SitArrival() {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [arrival, setArrival] = useState<{ pack: SitPack; code: string; key: string } | { error: true } | null>(null);
  const [taken, setTaken] = useState<boolean | null>(null);
  useEffect(() => {
    const read = async () => {
      const m = location.hash.match(/^#sit=([a-f0-9]{24})\.([a-f0-9]{32})$/);
      if (!m) return;
      history.replaceState(null, "", location.pathname + location.search);
      const pack = await collect(m[1]!);
      setArrival(pack ? { pack, code: m[1]!, key: m[2]! } : { error: true });
    };
    void read();
    // Back or Forward onto a sitting link already taken in only clears it: the pet is not collected twice (P6)
    return watchLinks(
      () => void read(),
      () => {
        if (/^#sit=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      },
    );
  }, []);
  const art = useMemo(
    () =>
      arrival && "pack" in arrival
        ? drawPet(arrival.pack.pet.line, drawn(stageOf(arrival.pack.pet, now())), { expression: "happy" })
        : null,
    [arrival],
  );
  if (!arrival) return null;
  const close = () => setArrival(null);
  if ("error" in arrival)
    return (
      <div className="fam-modal" role="dialog" aria-modal="true">
        <div className="fam-card">
          <p>
            {lang === "zh"
              ? "这个照看链接打不开了（可能已经结束）。"
              : "This sitting link can't be opened (it may have ended)."}
          </p>
          <button type="button" className="btn" onClick={close}>
            {lang === "zh" ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  const { pack } = arrival;
  return (
    <div
      className="fam-modal"
      role="dialog"
      aria-modal="true"
      aria-label={lang === "zh" ? "来住几天" : "Coming to stay"}
    >
      <motion.div
        className="fam-card duel-card"
        initial={reduce ? false : { y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
      >
        {art && <Sprite canvas={art} palette={PALETTE_OF[pack.pet.line]} scale={4} label={pack.pet.name} />}
        <h3>
          {lang === "zh"
            ? `${pack.pet.name}来你家住到 ${day(pack.until, lang)}`
            : `${pack.pet.name} is coming to stay until ${day(pack.until, lang)}`}
        </h3>
        <p className="small">
          {lang === "zh"
            ? "照顾它、陪它玩；它想什么都由它自己的大脑决定。到时候把它送回家，它的主人会核对你们相处的每一刻。"
            : "Feed it, play with it; what it does is up to its own brain. When the time comes, send it home, and its owner's game checks every moment it spent with you."}
        </p>
        {taken === false && (
          <p className="small sp-warn">
            {lang === "zh"
              ? "接不了：它已经在你这里了，或者你已经有 8 只宠物。"
              : "It can't come: it is already here, or you already have 8 pets."}
          </p>
        )}
        {taken ? (
          <button type="button" className="btn primary" onClick={close}>
            {lang === "zh" ? "去看看它" : "Go and see it"}
          </button>
        ) : (
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                play("success");
                setTaken(takeIn(pack, arrival.code, arrival.key));
              }}
            >
              {lang === "zh" ? "好，我来照顾" : "Take care of it"}
            </button>
            <button type="button" className="btn" onClick={close}>
              {lang === "zh" ? "以后再说" : "Not now"}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
