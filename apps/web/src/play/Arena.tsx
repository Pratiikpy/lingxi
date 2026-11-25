/**
 * Friendly spars. Pick a partner, watch the fight round by round (every move is
 * the pet's own circuit answering the fight on its pins), then hear from the
 * coach, who tests every fight lesson the pet has room for and suggests the one
 * that actually wins more.
 */

import { useEffect, useState } from "react";
import { PAID_SPARS_PER_DAY, paidSparsLeft } from "@lingxi/world";
import { type Fighter, PARTNERS, type Partner, type Pet, encodeChallenge, stageOf } from "@lingxi/game";
import { linkPrefix } from "../game/links";
import { now } from "../game/gameClock";
import { type ArenaFight, BEHEMOTH, drawn, duelPetOf, startFight, useArena } from "../game/arenaFight";

import { useLang } from "../i18n";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { songForHour, useMusic } from "../game/music";
import "./arena.css";
import "./rewind.css";
import { RunCard, RunView } from "./ArenaRun";
import { SeasonCard } from "./Season";
import { linkToken } from "../game/duelLinks";
import { FightView } from "./arena/FightView";
import { DailyCard, DesignedPartners, FlyBrains, PartnerCard } from "./arena/Partners";
import { type Lang } from "./arena/shared";

export { FightView } from "./arena/FightView";

export function ArenaPanel({ pet }: { pet: Pet }) {
  const lang = useLang((s) => s.lang) as Lang;
  const fight = useArena((s) => s.fight);
  const setFight = (f: ArenaFight | null) => useArena.setState({ fight: f });
  const [link, setLink] = useState("");
  const [cheer, setCheer] = useState(false);
  const [running, setRunning] = useState(false);
  const fighting = fight !== null || running;
  const paidLeft = useWorld((s) => paidSparsLeft(s.world, now()));
  useEffect(() => {
    if (!fighting) return;
    useMusic.getState().want("spar");
    return () => useMusic.getState().want(songForHour(new Date(now()).getHours()));
  }, [fighting]);
  const start = (partner: Partner, daily?: { seed: number; day: number }, opponent?: Fighter) =>
    startFight(pet, partner, { ...(daily ? { daily } : {}), ...(opponent ? { opponent } : {}), cheer });
  if (running) return <RunView pet={pet} onClose={() => setRunning(false)} />;
  if (fight) {
    const { again, ...shown } = fight;
    return (
      <FightView
        key={`${fight.result.seed}${again ? ":again" : ""}`}
        pet={pet}
        self={{ name: pet.name, line: pet.line, stage: drawn(stageOf(pet, now())) }}
        {...shown}
        replay={again}
        onDone={() => setFight(null)}
        onRematch={() => start(fight.partner, undefined, fight.opponent)}
        onWatchAgain={() => setFight({ ...fight, again: true })}
      />
    );
  }

  const makeLink = async () => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    // a short link when the live server keeps the challenge, the whole code when there is none (A32)
    const url = `${linkPrefix("play.html")}duel=${await linkToken(encodeChallenge({ id, from: duelPetOf(pet), at: now() }))}`;
    setLink(url);
    play("success");
    try {
      if (navigator.share)
        await navigator.share({
          title: lang === "zh" ? `${pet.name}向你发起切磋` : `${pet.name} challenges your pet`,
          url,
        });
      else await navigator.clipboard.writeText(url);
    } catch {
      // the share sheet was dismissed; the link stays on screen to copy
    }
  };

  return (
    <div className="sp-arena">
      <p className="small">
        {lang === "zh"
          ? `${pet.name}的每一招都由它自己的大脑电路决定。你教它的东西，会改变它怎么切磋。`
          : `Every move ${pet.name} makes comes from its own brain circuit. What you teach changes how it spars.`}
      </p>
      <label className="sp-cheer">
        <input type="checkbox" checked={cheer} onChange={(e) => setCheer(e.target.checked)} />
        <span>
          {lang === "zh" ? "在场边为它加油（它会感觉到你在身边）" : "Cheer from the side (it feels you're there)"}
        </span>
      </label>
      <div className="sp-duel">
        <button type="button" className="btn primary" onClick={makeLink}>
          {lang === "zh" ? "用链接向朋友发起切磋" : "Challenge a friend by link"}
        </button>
        {link && (
          <>
            <input
              className="sp-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={lang === "zh" ? "切磋链接" : "Challenge link"}
            />
            <p className="small">
              {lang === "zh"
                ? `链接里带着${pet.name}现在的大脑和故事。朋友用自己的宠物应战，结果谁都能重放验证。`
                : `The link carries ${pet.name}'s brain and story as they are now. Your friend answers with their own pet, and anyone can replay the result.`}
            </p>
          </>
        )}
      </div>
      <RunCard onOpen={() => setRunning(true)} />
      <DailyCard pet={pet} onStart={(partner, seed, day) => start(partner, { seed, day })} />
      <SeasonCard pet={pet} />
      <section className="sp-behemoth" aria-label={lang === "zh" ? "战胜巨兽" : "Beat the Behemoth"}>
        <div>
          <p className="label">{lang === "zh" ? "建设者小巷 · 战胜巨兽" : "Builders' Lane · Beat the Behemoth"}</p>
          <p className="small">
            {lang === "zh"
              ? "巨兽不看你出什么。每一回合，创始人那台 4 位处理器走九步，累加器低三位的灯决定它的招式。每次都是同一套，所以可以教你的宠物读懂它。"
              : "Behemoth doesn't look at the fight. Each round the founder's 4-bit CPU runs nine steps, and the three low lamps of its accumulator pick the move. It is the same every time, so your pet can be taught to read it."}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => start(BEHEMOTH.partner, undefined, BEHEMOTH.opponent())}
        >
          {lang === "zh" ? "切磋" : "Spar"}
        </button>
      </section>
      <p className="small sp-purse" role="status">
        {paidLeft > 0
          ? lang === "zh"
            ? `今天还有 ${paidLeft}/${PAID_SPARS_PER_DAY} 场有奖切磋：赢了（或技能保底的输）就发金币。之后的切磋是练习，不限次数，照样算任务和徽章。`
            : `${paidLeft} of ${PAID_SPARS_PER_DAY} paid spars left today: a win (or a loss a skill pays for) earns coins. After that, spars are free practice, as many as you like, and still count for quests and badges.`
          : lang === "zh"
            ? `今天 ${PAID_SPARS_PER_DAY} 场有奖切磋已经用完。现在切磋是练习：不发金币，任务、徽章和战绩照样算。明天再发。`
            : `Today's ${PAID_SPARS_PER_DAY} paid spars are used. Spars now are practice: no coins, but quests, badges and the record still count. More pay tomorrow.`}
      </p>
      <ul className="sp-partners">
        {PARTNERS.map((p, i) => (
          <PartnerCard key={p.id} partner={p} index={i} lang={lang} onPick={() => start(p)} />
        ))}
      </ul>
      <DesignedPartners onPick={(p) => start(p)} />
      <FlyBrains pet={pet} onFight={(partner, opponent) => start(partner, undefined, opponent)} />
    </div>
  );
}
