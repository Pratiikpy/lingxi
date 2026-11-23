/**
 * The three mini-games (PRD C3): Catch the Treats, Follow the Pattern, and a
 * seasonal Hide-and-Seek whose dress changes with the time of year. Each lasts
 * well under a minute; up to three stars make the play more cheering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { drawPet } from "@lingxi/art";
import { resultLine } from "./gameResult";
import { type GameId, type Pet, SEASONAL, afterSwaps, gameSeasonAt, nextPattern, shuffles, stageOf, starsFor, toVisible } from "@lingxi/game";
import { HOME, ITEM, ROOMS } from "@lingxi/world";
import { useWorld } from "../game/world";
import { PRESS_MS, showSteps } from "../game/patternShow";
import { LifePanel } from "./Jobs";
import { useLang } from "../i18n";
import { useGame } from "../game/store";
import { play } from "../game/sound";
import { PALETTE_OF, type PetStage } from "../scene/palette";
import { Sprite } from "./Sprite";
import { Icon, type IconName } from "./icons";
import "./games.css";
import { now } from "../game/gameClock";

type Lang = "en" | "zh";
const drawn = (s: string): PetStage => (s === "elder" ? "adult" : (s as PetStage));
const TREATS = [11301, 11302, 11303, 11304, 11313].filter((id) => ITEM[id]);

export function GamesPanel({ pet, onDone, onSchool }: { pet: Pet; onDone: () => void; onSchool: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const act = useGame((s) => s.act);
  const [game, setGame] = useState<GameId | null>(null);
  const [result, setResult] = useState<{ game: GameId; score: number; stars: number } | null>(null);
  // D11: the world's season, the one the home screen names
  const season = gameSeasonAt(now());
  const seasonal = SEASONAL[season];
  const block = pet.asleep
    ? lang === "zh"
      ? `${pet.name}在睡觉。`
      : `${pet.name} is asleep.`
    : pet.sick
      ? lang === "zh"
        ? `${pet.name}生病了，先吃药吧。`
        : `${pet.name} is ill. Medicine first.`
      : toVisible(pet.meters.energy) < 120
        ? lang === "zh"
          ? `${pet.name}太累了，让它歇一会儿。`
          : `${pet.name} is too tired. Let it rest.`
        : null;

  const finish = useCallback(
    (g: GameId, score: number) => {
      const stars = starsFor(g, score);
      act({ kind: "play", stars });
      play(stars >= 2 ? "success" : "pop");
      setResult({ game: g, score, stars });
      setGame(null);
    },
    [act],
  );

  if (game === "catch") return <CatchGame pet={pet} onEnd={(s) => finish("catch", s)} />;
  if (game === "pattern") return <PatternGame onEnd={(s) => finish("pattern", s)} />;
  if (game === "seasonal") return <SeekGame pet={pet} season={season} onEnd={(s) => finish("seasonal", s)} />;

  const games: Array<[GameId, IconName, { en: string; zh: string }, { en: string; zh: string }]> = [
    ["catch", "bowl", { en: "Catch the Treats", zh: "接零食" }, { en: "Move to catch what falls. 20 seconds.", zh: "左右移动接住掉下来的零食，20 秒。" }],
    ["pattern", "note", { en: "Follow the Pattern", zh: "跟着节奏" }, { en: "Watch the lights, then repeat them.", zh: "看灯亮的顺序，再照着按一遍。" }],
    ["seasonal", "star", { en: seasonal.en, zh: seasonal.zh }, { en: `Watch which of the ${seasonal.hideIn.en} it hides in. Changes with the season.`, zh: `看它躲进哪个${seasonal.hideIn.zh}里。随季节变换。` }],
  ];
  return (
    <div className="games">
      <LifePanel pet={pet} onSchool={onSchool} blocked={block} />
      {result && (
        <div className="game-result" role="status">
          <span className="stars" aria-label={`${result.stars}/3`}>
            {[0, 1, 2].map((i) => (
              <Icon key={i} name="star" size={22} className={i < result.stars ? "on" : ""} />
            ))}
          </span>
          <p>
            {resultLine(result.score, result.stars, pet.name, lang === "zh" ? "zh" : "en")}
          </p>
        </div>
      )}
      {block && <p className="small warn">{block}</p>}
      <ul className="game-list">
        {games.map(([id, icon, name, how]) => (
          <li key={id}>
            <button type="button" className="game-card" disabled={!!block} onClick={() => (play("tap"), setResult(null), setGame(id))}>
              <Icon name={icon} size={26} />
              <span>
                <b>{name[lang]}</b>
                <small>{how[lang]}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {result && (
        <button type="button" className="btn" onClick={onDone}>
          {lang === "zh" ? "回到房间" : "Back to the room"}
        </button>
      )}
    </div>
  );
}

/* ── Catch the Treats ─────────────────────────────────────────────────────── */

interface Drop {
  id: number;
  x: number;
  y: number;
  vy: number;
  item: number;
}

function CatchGame({ pet, onEnd }: { pet: Pet; onEnd: (score: number) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const area = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(50);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(20);
  const st = useRef({ x: 50, drops: [] as Drop[], score: 0, next: 0, id: 0, start: 0, ended: false });
  const art = useMemo(() => drawPet(pet.line, drawn(stageOf(pet, now())), { expression: "happy", ...(pet.form ? { form: pet.form } : {}) }), [pet]);
  const room = useWorld((s) => s.world.room);
  const backdrop = (ROOMS[room] ?? ROOMS[HOME]!).bgs.day;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    st.current.start = last;
    const tick = (now: number) => {
      const s = st.current;
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      const t = (now - s.start) / 1000;
      if (t >= 20) {
        if (!s.ended) {
          s.ended = true;
          onEnd(s.score);
        }
        return;
      }
      if (now >= s.next) {
        s.drops.push({ id: s.id++, x: 8 + Math.random() * 84, y: -8, vy: 30 + t * 2.5 + Math.random() * 12, item: TREATS[Math.floor(Math.random() * TREATS.length)] ?? 11301 });
        s.next = now + Math.max(420, 900 - t * 20);
      }
      const kept: Drop[] = [];
      for (const d of s.drops) {
        d.y += d.vy * dt;
        if (d.y >= 78 && d.y <= 90 && Math.abs(d.x - s.x) < 10) {
          s.score += 1;
          play("pop");
          continue;
        }
        if (d.y < 105) kept.push(d);
      }
      s.drops = kept;
      setDrops(kept.map((d) => ({ ...d })));
      setScore(s.score);
      setLeft(Math.ceil(20 - t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") st.current.x = Math.max(6, st.current.x - 8);
      if (e.key === "ArrowRight") st.current.x = Math.min(94, st.current.x + 8);
      setX(st.current.x);
    };
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
  }, [onEnd]);

  const move = (clientX: number) => {
    const r = area.current?.getBoundingClientRect();
    if (!r) return;
    st.current.x = Math.max(6, Math.min(94, ((clientX - r.left) / r.width) * 100));
    setX(st.current.x);
  };
  return (
    <div className="game">
      <div className="game-hud">
        <span>{lang === "zh" ? `接到 ${score}` : `Caught ${score}`}</span>
        <span>{lang === "zh" ? `${left} 秒` : `${left}s`}</span>
      </div>
      <div
        ref={area}
        className="catch-area"
        style={{ backgroundImage: `url(${backdrop})` }}
        role="application"
        aria-label={lang === "zh" ? "左右移动来接零食，也可以用方向键" : "Move left and right to catch treats; arrow keys work too"}
        onPointerMove={(e) => move(e.clientX)}
        onPointerDown={(e) => move(e.clientX)}
      >
        {drops.map((d) => (
          <img key={d.id} className="pixel drop" src={ITEM[d.item]?.art} alt="" style={{ left: `${d.x}%`, top: `${d.y}%` }} />
        ))}
        <div className="catcher" style={{ left: `${x}%` }}>
          <Sprite canvas={art} palette={PALETTE_OF[pet.line]} scale={3} />
        </div>
      </div>
    </div>
  );
}

/* ── Follow the Pattern ───────────────────────────────────────────────────── */

const PADS: Array<[IconName, string]> = [
  ["heart", "#ff7a9a"],
  ["star", "#ffc83d"],
  ["note", "#5ea8ff"],
  ["sparkle", "#7bd389"],
];

function PatternGame({ onEnd }: { onEnd: (score: number) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0);
  const [seq, setSeq] = useState<number[]>(() => nextPattern([], seed));
  const [lit, setLit] = useState<number | null>(null);
  const [phase, setPhase] = useState<"show" | "input">("show");
  const [pos, setPos] = useState(0);
  // the light of the player's last press; the showing cancels it and puts it out itself (A9)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the showing: its steps, and the one on screen (-1 before the first)
  const steps = useMemo(() => showSteps(seq, reduce ? 700 : 560), [seq, reduce]);
  const [shown, setShown] = useState(-1);
  const litPad = phase === "show" && shown >= 0 ? steps[shown]!.lit : lit;

  // a showing begins (with none of its steps on screen: the last showing's end put them away): the press's own timer
  // is cancelled, and the first step, the press going out, comes after a press's time
  useEffect(() => {
    if (phase !== "show") return;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    const id = setTimeout(() => setShown(0), PRESS_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // each step, once it is on screen (an effect runs after the change is shown), waits its time before the next: a
  // busy or slow phone stretches the showing, and never cuts a light short
  useEffect(() => {
    if (phase !== "show" || shown < 0) return;
    if (steps[shown]!.lit !== null) play("tap");
    const last = shown === steps.length - 1;
    const id = setTimeout(
      () => {
        if (!last) return setShown(shown + 1);
        setLit(null);
        setShown(-1);
        setPhase("input");
        setPos(0);
      },
      last ? 0 : steps[shown + 1]!.at - steps[shown]!.at,
    );
    return () => clearTimeout(id);
  }, [phase, shown, steps]);

  const press = (k: number) => {
    if (phase !== "input") return;
    setLit(k);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setLit(null), PRESS_MS);
    if (seq[pos] !== k) {
      play("error");
      onEnd(seq.length - 1);
      return;
    }
    play("pop");
    if (pos + 1 === seq.length) {
      if (seq.length >= 8) return onEnd(seq.length);
      setSeq(nextPattern(seq, seed));
      setPhase("show");
    } else setPos(pos + 1);
  };
  return (
    <div className="game">
      <div className="game-hud">
        <span>{lang === "zh" ? `长度 ${seq.length}` : `Length ${seq.length}`}</span>
        <span>{phase === "show" ? (lang === "zh" ? "看好……" : "Watch…") : lang === "zh" ? "轮到你了" : "Your turn"}</span>
      </div>
      <div className="pads">
        {PADS.map(([icon, color], k) => (
          <button key={k} type="button" className={`pad${litPad === k ? " lit" : ""}`} style={{ ["--pad" as string]: color }} onClick={() => press(k)} disabled={phase !== "input"} aria-label={icon}>
            <Icon name={icon} size={30} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Seasonal Hide-and-Seek ───────────────────────────────────────────────── */

const SPOT_COLOURS: Record<string, [string, string]> = {
  spring: ["#ffb7d0", "#ff8fb6"],
  summer: ["#ffe2b8", "#f5b97a"],
  autumn: ["#f0a35a", "#c9692e"],
  winter: ["#eef6ff", "#c3dcf5"],
};

function SeekGame({ pet, season, onEnd }: { pet: Pet; season: keyof typeof SEASONAL; onEnd: (score: number) => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const reduce = useReducedMotion() ?? false;
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [slots, setSlots] = useState([0, 1, 2]); // slots[cup] = position
  const [phase, setPhase] = useState<"peek" | "mix" | "pick" | "reveal">("peek");
  const [hidden] = useState(() => (seed >>> 3) % 3);
  const [picked, setPicked] = useState<number | null>(null);
  const art = useMemo(() => drawPet(pet.line, drawn(stageOf(pet, now())), { expression: "sparkly", ...(pet.form ? { form: pet.form } : {}) }), [pet]);
  const swaps = useMemo(() => shuffles(round, seed + round * 7919), [round, seed]);
  const [c1, c2] = SPOT_COLOURS[season]!;

  useEffect(() => {
    if (phase === "peek") {
      const id = setTimeout(() => setPhase("mix"), 1100);
      return () => clearTimeout(id);
    }
    if (phase !== "mix") return;
    let i = 0;
    const step = reduce ? 520 : Math.max(260, 520 - round * 90);
    const id = setInterval(() => {
      if (i >= swaps.length) {
        clearInterval(id);
        setPhase("pick");
        return;
      }
      const [a, b] = swaps[i]!;
      setSlots((s) => {
        const n = s.slice();
        const ia = n.indexOf(a);
        const ib = n.indexOf(b);
        [n[ia], n[ib]] = [n[ib]!, n[ia]!];
        return n;
      });
      play("tap");
      i++;
    }, step);
    return () => clearInterval(id);
  }, [phase, swaps, round, reduce]);

  // the cup that started at the pet's position ends where the swaps carried it
  const answer = afterSwaps(hidden, swaps);
  const pick = (position: number) => {
    if (phase !== "pick") return;
    setPicked(position);
    setPhase("reveal");
    const right = position === answer;
    play(right ? "success" : "error");
    const nextScore = score + (right ? 1 : 0);
    setScore(nextScore);
    setTimeout(() => {
      if (round >= 2) return onEnd(nextScore);
      setRound(round + 1);
      setPicked(null);
      // the cups go back where they started before the pet peeks out again
      setSlots([0, 1, 2]);
      setPhase("peek");
    }, 1200);
  };
  return (
    <div className="game">
      <div className="game-hud">
        <span>{lang === "zh" ? `第 ${round + 1} / 3 轮 · 找到 ${score}` : `Round ${round + 1} of 3 · found ${score}`}</span>
        <span>{phase === "pick" ? (lang === "zh" ? "它在哪儿？" : "Where is it?") : phase === "mix" ? (lang === "zh" ? "盯紧了……" : "Keep watching…") : ""}</span>
      </div>
      <div className="seek-area">
        {[0, 1, 2].map((cup) => {
          const position = slots[cup]!;
          // the pet hides under the cup that started where it stood
          const isPetCup = cup === hidden;
          const showPet = isPetCup && (phase === "peek" || phase === "reveal");
          const wrong = phase === "reveal" && picked === position && !isPetCup;
          return (
            <motion.button
              key={cup}
              type="button"
              className={`spot${wrong ? " wrong" : ""}`}
              onClick={() => pick(position)}
              disabled={phase !== "pick"}
              aria-label={lang === "zh" ? `第 ${position + 1} 个${SEASONAL[season].hideIn.zh}` : `${SEASONAL[season].hideIn.en} ${position + 1}`}
              initial={false}
              animate={{ left: `${position * 33.33}%` }}
              transition={{ duration: reduce ? 0 : 0.22, ease: "easeInOut" }}
            >
              <span className="spot-pet" style={{ opacity: showPet ? 1 : 0 }}>
                <Sprite canvas={art} palette={PALETTE_OF[pet.line]} scale={1.5} />
              </span>
              <span className="spot-cover" style={{ background: `radial-gradient(circle at 40% 35%, ${c1}, ${c2})`, transform: showPet ? "translateY(-46px)" : "none" }} />
            </motion.button>
          );
        })}
      </div>
      <p className="small">
        {lang === "zh" ? `${SEASONAL[season].zh}：看准它躲进哪个${SEASONAL[season].hideIn.zh}。` : `${SEASONAL[season].en}: keep your eye on its hiding place.`}
      </p>
    </div>
  );
}
