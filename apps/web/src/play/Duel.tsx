/**
 * Challenges arriving by link (PRD F23): a friend's pet walks in with its name
 * and story and asks for a spar; our pet answers with its own brain. A result
 * link replays the same fight for anyone, pet or no pet.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { drawPet } from "@lingxi/art";
import { type Challenge, type DuelResult, decodeChallenge, decodeResult, duel } from "@lingxi/game";
import { useLang } from "../i18n";
import { play } from "../game/sound";
import { PALETTE_OF, type PetStage } from "../scene/textures";
import { FightView, partnerOfDuel } from "./Arena";
import { Sprite } from "./Sprite";
import { tokenCode } from "../game/duelLinks";

type Lang = "en" | "zh";
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));
const PENDING = "lingxi.duel.pending";

const NATURE: Record<string, { en: string; zh: string }> = {
  brave: { en: "brave", zh: "勇敢" },
  curious: { en: "curious", zh: "好奇" },
  greedy: { en: "greedy", zh: "嘴馋" },
  calm: { en: "calm", zh: "沉稳" },
  playful: { en: "playful", zh: "贪玩" },
  gentle: { en: "gentle", zh: "温柔" },
  shy: { en: "shy", zh: "害羞" },
};

const clearHash = () => history.replaceState(null, "", location.pathname + location.search);

type Token = { kind: "challenge" | "result"; token: string };
/** `lost`: a short link whose code could not be had (the server no longer keeps it, or cannot be reached). */
type Arrival = { kind: "challenge"; challenge: Challenge; code: string } | { kind: "result"; result: DuelResult } | { kind: "error" } | { kind: "lost"; token: Token };

/** The link in the address: a challenge or a result, as its code or as a short token the server keeps (A32). */
function hashToken(): Token | null {
  const c = location.hash.match(/^#duel=(lxc1\.[A-Za-z0-9_-]+|s\.[A-Za-z0-9_-]{16})$/);
  const r = location.hash.match(/^#duelr=(lxr1\.[A-Za-z0-9_-]+|s\.[A-Za-z0-9_-]{16})$/);
  return c ? { kind: "challenge", token: c[1]! } : r ? { kind: "result", token: r[1]! } : null;
}

/** What arrived: the code a token stands for (checked against its id), read as the game reads a duel. */
async function arrivalOf(t: Token): Promise<Arrival> {
  const code = await tokenCode(t.token);
  if (!code && t.token.startsWith("s.")) return { kind: "lost", token: t };
  try {
    if (code && t.kind === "challenge" && code.startsWith("lxc1.")) return { kind: "challenge", challenge: decodeChallenge(code), code };
    if (code && t.kind === "result" && code.startsWith("lxr1.")) return { kind: "result", result: decodeResult(code) };
  } catch {
    // a damaged code reads as an error below
  }
  return { kind: "error" };
}

export function DuelArrival({ hasPet, petName, onAccept }: { hasPet: boolean; petName?: string; onAccept?: (c: Challenge) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [arrival, setArrival] = useState<Arrival | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      const t = hashToken();
      if (t) {
        clearHash();
        void arrivalOf(t).then((a) => {
          if (!live) return;
          setArrival(a);
          // a challenge opened before hatching waits until there is a pet to answer it
          if (a.kind === "challenge") sessionStorage.setItem(PENDING, a.code);
        });
        return;
      }
      if (hasPet) {
        try {
          // the held code is checked again, exactly as if it had just arrived
          const held = sessionStorage.getItem(PENDING);
          if (held) setArrival({ kind: "challenge", challenge: decodeChallenge(held), code: held });
        } catch {
          sessionStorage.removeItem(PENDING);
        }
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => {
      live = false;
      window.removeEventListener("hashchange", read);
    };
  }, [hasPet]);

  const close = () => {
    sessionStorage.removeItem(PENDING);
    setArrival(null);
  };
  const challenger = arrival?.kind === "challenge" ? arrival.challenge.from : null;
  const art = useMemo(() => (challenger ? drawPet(challenger.line, drawn(challenger.stage), { expression: "proud" }) : null), [challenger]);
  const replay = useMemo(() => (arrival?.kind === "result" ? duel(arrival.result.challenge, arrival.result.reply, arrival.result.version) : null), [arrival]);

  if (!arrival) return null;
  if (arrival.kind === "lost") {
    const { token } = arrival;
    return (
      <div className="fam-modal" role="dialog" aria-modal="true">
        <div className="fam-card">
          <p>
            {lang === "zh"
              ? "找不到这个切磋链接：它可能已经过期，或者暂时连不上服务器。可以再试一次，或请朋友重新发一个。"
              : "This spar link can't be found: it may have expired, or the server can't be reached right now. Try again, or ask your friend for a new one."}
          </p>
          <div className="row">
            <button type="button" className="btn primary" onClick={() =>
                void arrivalOf(token).then((a) => {
                  setArrival(a);
                  if (a.kind === "challenge") sessionStorage.setItem(PENDING, a.code);
                })
              }>
              {lang === "zh" ? "再试一次" : "Try again"}
            </button>
            <button type="button" className="btn" onClick={close}>
              {lang === "zh" ? "好的" : "OK"}
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (arrival.kind === "error") {
    return (
      <div className="fam-modal" role="dialog" aria-modal="true">
        <div className="fam-card">
          <p>{lang === "zh" ? "这个切磋链接坏了，打不开。" : "This spar link is damaged and can't be opened."}</p>
          <button type="button" className="btn" onClick={close}>
            {lang === "zh" ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  }
  if (arrival.kind === "result" && replay) {
    const { challenge, reply } = arrival.result;
    return (
      <div className="fam-modal" role="dialog" aria-modal="true" aria-label={lang === "zh" ? "切磋回放" : "Spar replay"}>
        <div className="fam-card duel-replay">
          <p className="label">{lang === "zh" ? `${reply.name} 对 ${challenge.from.name}` : `${reply.name} vs ${challenge.from.name}`}</p>
          <FightView self={{ name: reply.name, line: reply.line, stage: drawn(reply.stage) }} partner={partnerOfDuel(challenge)} result={replay} cheer={false} replay onDone={close} onRematch={close} />
        </div>
      </div>
    );
  }
  const c = (arrival as { challenge: Challenge }).challenge;
  const story = c.from.story;
  const facts = [
    lang === "zh" ? `${story.days} 天大` : `${story.days} ${story.days === 1 ? "day" : "days"} old`,
    lang === "zh" ? `学过 ${story.lessons} 课` : `taught ${story.lessons} ${story.lessons === 1 ? "lesson" : "lessons"}`,
    ...story.nature.map((n) => NATURE[n]?.[lang] ?? n),
  ];
  return (
    <div className="fam-modal" role="dialog" aria-modal="true" aria-label={lang === "zh" ? "切磋邀请" : "A spar challenge"}>
      <motion.div className="fam-card duel-card" initial={reduce ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
        <motion.div animate={reduce ? {} : { y: [0, -6, 0] }} transition={{ duration: 0.6, repeat: 2 }}>
          {art && <Sprite canvas={art} palette={PALETTE_OF[c.from.line]} scale={5} label={c.from.name} />}
        </motion.div>
        <h3>{lang === "zh" ? `${c.from.name}想和你的宠物切磋！` : `${c.from.name} wants a spar with your pet!`}</h3>
        <p className="duel-facts">{facts.join(" · ")}</p>
        <p className="small">
          {lang === "zh"
            ? `${c.from.name}会用它自己真实的大脑出招。你的宠物也一样。`
            : `${c.from.name} will fight with its own real brain, and so will your pet.`}
        </p>
        {hasPet ? (
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                play("tap");
                close();
                onAccept?.(c);
              }}
            >
              {lang === "zh" ? `让${petName ?? "它"}应战` : `Let ${petName ?? "my pet"} accept`}
            </button>
            <button type="button" className="btn" onClick={close}>
              {lang === "zh" ? "以后再说" : "Not now"}
            </button>
          </div>
        ) : (
          <>
            <p className="small">{lang === "zh" ? "先孵一只宠物，它就能应战。邀请会等着你。" : "Hatch a pet first and it can answer. The challenge will wait for you."}</p>
            <button type="button" className="btn primary" onClick={() => setArrival(null)}>
              {lang === "zh" ? "去孵蛋" : "Hatch a pet"}
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
}
