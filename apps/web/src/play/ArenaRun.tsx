/**
 * Arena runs (PRD A1, A2): your pet leads a line of up to four companions.
 * Between battles you buy, roll, freeze, sell and reorder; each battle is a team
 * spar where every unit's own brain circuit picks its move every round. Win 10
 * trophies before losing 5 hearts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LILAC, MINT, NIGHT, PEACH, type OverlayPixel, type Outfit, type Palette, drawPet, type Expression, wearOverlay } from "@lingxi/art";
import { outfitOf } from "@lingxi/world";
import {
  COMPANION,
  MAX_COMPANIONS,
  ROLL_COST,
  SELL_BACK,
  START_HEARTS,
  TROPHIES_TO_WIN,
  type CompanionDef,
  type Move,
  type Pet,
  type RunState,
  type TeamResult,
  type TeamUnit,
  type DuelPet,
  battleSeed,
  buy,
  dayOf,
  duelFighter,
  petCard,
  fighterFrom,
  fighterOfMind,
  ghostLevel,
  ghostTeam,
  outcome,
  roll,
  runGrid,
  sell,
  settle,
  shift,
  stageOf,
  teamSpar,
  toggleFreeze,
} from "@lingxi/game";
import { useLang } from "../i18n";
import { RUN_WIN_COINS, useRun } from "../game/arenarun";
import { type Rival, findRival, saveLine } from "../game/arenaApi";
import { checkTeamOnChain } from "../game/battleCheck";
import { ChainCheck } from "./ChainCheck";
import { useWorld } from "../game/world";
import { useBadges } from "../game/badges";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Sprite } from "./Sprite";
import { boundingBox, type PixelCanvas } from "@lingxi/art";
import "./arenarun.css";
import { noteEvent, noteTally } from "../game/tally";

type Lang = "en" | "zh";
const PALETTE: Record<CompanionDef["look"]["palette"], Palette> = { mint: MINT, lilac: LILAC, peach: PEACH, night: NIGHT };
const MOVE: Record<Move, [string, string]> = {
  tap: ["Tap", "轻拍"],
  snack: ["Snack", "吃点心"],
  pounce: ["Pounce!", "猛扑！"],
  rest: ["Rest", "歇一歇"],
  dodge: ["Dodge", "闪开"],
  guard: ["Guard", "防守"],
  charm: ["Charm", "撒娇"],
  gift: ["Gift", "送礼"],
};
const PET_HP = 100;
/** every pet fights at the same level in the arena: lessons and line-up decide, not age, and a claimed age gains nothing */
const ARENA_PET_LEVEL = 1;
const ROUND_MS = 760;

function Art({ canvas, palette, scale, label, overlay }: { canvas: PixelCanvas; palette: Palette; scale: number; label?: string; overlay?: readonly OverlayPixel[] }) {
  const b = boundingBox(canvas);
  const crop = { x: Math.max(0, b.x - 1), y: Math.max(0, b.y - 1), w: Math.min(canvas.w - Math.max(0, b.x - 1), b.w + 2), h: Math.min(canvas.h - Math.max(0, b.y - 1), b.h + 2) };
  return <Sprite canvas={canvas} palette={palette} scale={scale} crop={crop} label={label} overlay={overlay} />;
}

function CompanionArt({ id, scale, face = "happy", label }: { id: string; scale: number; face?: Expression; label?: string }) {
  const c = COMPANION[id]!;
  const canvas = useMemo(() => drawPet(c.look.line, c.look.stage, { expression: face }), [c.look.line, c.look.stage, face]);
  return <Art canvas={canvas} palette={PALETTE[c.look.palette]} scale={scale} label={label} />;
}

function PetArt({ pet, scale, face = "happy" }: { pet: Pet; scale: number; face?: Expression }) {
  const stage = stageOf(pet, Date.now());
  const drawn = stage === "elder" ? "adult" : stage;
  const world = useWorld((s) => s.world);
  const worn = outfitOf(world, String(pet.bornAt)) as Outfit;
  const canvas = useMemo(() => drawPet(pet.line, drawn as "baby", { expression: face, ...(pet.form ? { form: pet.form } : {}) }), [pet.line, drawn, face, pet.form]);
  const overlay = useMemo(() => (worn.head || worn.face || worn.held ? wearOverlay(canvas, pet.line, drawn as "baby", worn, 0, pet.form) : undefined), [canvas, pet.line, drawn, worn.head, worn.face, worn.held, pet.form]);
  return <Art canvas={canvas} palette={PALETTE_OF[pet.line]} scale={scale} label={pet.name} overlay={overlay} />;
}

const companionUnit = (id: string, i: number, edge = 0): TeamUnit => {
  const c = COMPANION[id]!;
  const f = fighterFrom(c.name.en, c.program, Math.min(3, c.level + edge));
  return { id: `${id}:${i}`, name: c.name.en, brain: f.brain, memory: f.memory, hp: c.hp, level: f.level };
};

function petUnit(pet: Pet): TeamUnit {
  const f = fighterOfMind(pet.name, { line: pet.line, lessons: pet.lessons, family: pet.family, instincts: pet.instincts, outside: pet.outside }, ARENA_PET_LEVEL, pet.brain);
  return { id: "pet", name: pet.name, brain: f.brain, memory: f.memory, hp: PET_HP, level: ARENA_PET_LEVEL };
}

function RivalArt({ pet, scale, face = "happy" }: { pet: DuelPet; scale: number; face?: Expression }) {
  const drawn = pet.stage === "elder" ? "adult" : pet.stage;
  const canvas = useMemo(() => drawPet(pet.line, drawn as "baby", { expression: face }), [pet.line, drawn, face]);
  return <Art canvas={canvas} palette={PALETTE_OF[pet.line]} scale={scale} label={pet.name} />;
}

/** the pet as it travels to the arena: its name, body and card (lessons, instincts, family, memory) */
function linePet(pet: Pet): DuelPet {
  return { name: pet.name, line: pet.line, stage: stageOf(pet, Date.now()), card: petCard(pet), story: { days: dayOf(pet, Date.now()), lessons: pet.lessons.length, nature: [] } };
}

function rivalUnit(p: DuelPet): TeamUnit {
  const f = duelFighter(p);
  return { id: "rival", name: p.name, brain: f.brain, memory: f.memory, hp: PET_HP, level: ARENA_PET_LEVEL };
}

/** The entry card on the arena screen. */
export function RunCard({ onOpen }: { onOpen: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const { run, best, won } = useRun();
  const going = run && outcome(run) === "playing";
  return (
    <section className="ar-card" aria-label={lang === "zh" ? "竞技场闯关" : "Arena run"}>
      <div className="ar-card-art" aria-hidden="true">
        <CompanionArt id="bolt" scale={2} />
        <CompanionArt id="sprig" scale={2} />
        <CompanionArt id="wisp" scale={2} />
      </div>
      <div className="ar-card-text">
        <p className="label">{lang === "zh" ? "竞技场闯关 · 带上伙伴" : "Arena run · bring companions"}</p>
        <b>{lang === "zh" ? `赢 ${TROPHIES_TO_WIN} 座奖杯，别丢光 ${START_HEARTS} 颗心` : `Win ${TROPHIES_TO_WIN} trophies before you lose ${START_HEARTS} hearts`}</b>
        <span className="small">
          {going
            ? lang === "zh"
              ? `进行中：第 ${run.round + 1} 场，${run.trophies} 🏆，${run.hearts} ❤`
              : `In progress: battle ${run.round + 1}, ${run.trophies} 🏆, ${run.hearts} ❤`
            : best > 0
              ? lang === "zh"
                ? `最好成绩 ${best} 🏆 · 通关 ${won} 次`
                : `Best ${best} 🏆 · ${won} run${won === 1 ? "" : "s"} won`
              : lang === "zh"
                ? "每个伙伴都有自己的小电路大脑。"
                : "Every companion has its own small circuit brain."}
        </span>
      </div>
      <button type="button" className="btn primary" onClick={() => (play("tap"), onOpen())}>
        {going ? (lang === "zh" ? "继续" : "Continue") : lang === "zh" ? "开始" : "Start"}
      </button>
    </section>
  );
}

const WHY: Record<string, [string, string]> = {
  coins: ["Not enough coins.", "金币不够。"],
  full: [`Your line is full (${MAX_COMPANIONS} companions). Sell one first.`, `队伍满了（最多 ${MAX_COMPANIONS} 个伙伴），先卖掉一个。`],
  empty: ["That slot is empty.", "这一格是空的。"],
  over: ["This run is over.", "这一局已经结束。"],
  slot: ["That can't move further.", "不能再挪了。"],
};

export function RunView({ pet, onClose }: { pet: Pet; onClose: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const { run, begin, step, put, finish, abandon } = useRun();
  const [note, setNote] = useState("");
  const [battle, setBattle] = useState<{ result: TeamResult; foe: string[]; edge: number; rival?: DuelPet; before: RunState; units: { mine: TeamUnit[]; theirs: TeamUnit[] } } | null>(null);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    if (!run) begin();
  }, [run, begin]);
  if (!run) return null;
  const state = outcome(run);

  const act = (r: ReturnType<typeof buy>, sound: Parameters<typeof play>[0] = "tap") => {
    const why = step(r);
    setNote(why ? WHY[why]![lang === "zh" ? 1 : 0] : "");
    play(why ? "error" : sound);
  };

  const fight = async () => {
    if (finding) return;
    play("tap");
    setNote("");
    setFinding(true);
    const before = run;
    // the line goes up for later players at this round; then look for someone else's
    saveLine(before.round, linePet(pet), before.team);
    let rival: Rival | null = await findRival(before.round);
    let theirs: TeamUnit[] = [];
    if (rival) {
      try {
        theirs = [rivalUnit(rival.pet), ...rival.team.map((id, i) => companionUnit(id, i))];
      } catch {
        rival = null;
      }
    }
    const foe = rival ? rival.team : ghostTeam(before.seed, before.round);
    const edge = rival ? 0 : ghostLevel(before.round);
    if (!rival) theirs = foe.map((id, i) => companionUnit(id, i, edge));
    const mine = [petUnit(pet), ...before.team.map((id, i) => companionUnit(id, i))];
    setFinding(false);
    setBattle({ result: teamSpar(mine, theirs, battleSeed(before)), foe, edge, ...(rival ? { rival: rival.pet } : {}), before, units: { mine, theirs } });
  };

  if (battle)
    return (
      <TeamFight
        pet={pet}
        mine={battle.before.team}
        foe={battle.foe}
        edge={battle.edge}
        rival={battle.rival}
        units={battle.units}
        result={battle.result}
        round={battle.before.round}
        onDone={() => {
          const r = battle.result.winner;
          const next = settle(battle.before, r === 0 ? 1 : r === 1 ? -1 : 0);
          const end = outcome(next);
          if (end === "playing") put(next);
          else {
            finish(next, end === "won");
            noteEvent("run-finished");
            if (end === "won") {
              useWorld.getState().reward(RUN_WIN_COINS);
              useBadges.getState().note("sparWins");
              noteTally("SPAR_WIN");
              play("success");
            }
          }
          setBattle(null);
        }}
      />
    );

  if (state !== "playing")
    return (
      <div className="ar-run">
        <motion.div className="ar-end" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h3>{state === "won" ? L(`${pet.name}'s team won the run!`, `${pet.name}的队伍通关了！`) : L("The run is over", "这一局结束了")}</h3>
          <p className="ar-grid" aria-label={L("Battle by battle", "每一场的结果")}>{runGrid(run)}</p>
          <p>{L(`${run.trophies} trophies in ${run.history.length} battles.`, `${run.history.length} 场里拿了 ${run.trophies} 座奖杯。`)}</p>
          {state === "won" && <p className="sp-coins">{L(`+${RUN_WIN_COINS} coins`, `+${RUN_WIN_COINS} 金币`)}</p>}
          {state === "lost" && <p className="small">{L("Teach your pet, try a different line-up, and go again.", "教教你的宠物，换个阵容，再来一局。")}</p>}
          <div className="row">
            <button type="button" className="btn primary" onClick={() => (play("tap"), begin())}>
              {L("New run", "再来一局")}
            </button>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const text = `Lingxi arena: ${run.trophies}🏆 ${runGrid(run)}`;
                try {
                  if (navigator.share) await navigator.share({ text });
                  else await navigator.clipboard.writeText(text);
                  setNote(L("Copied.", "已复制。"));
                } catch {
                  // dismissed
                }
              }}
            >
              {L("Share result", "分享结果")}
            </button>
            <button type="button" className="btn" onClick={() => (abandon(), onClose())}>
              {L("Back", "返回")}
            </button>
          </div>
          {note && <p className="small">{note}</p>}
        </motion.div>
      </div>
    );

  return (
    <div className="ar-run">
      <div className="ar-top">
        <button type="button" className="link" onClick={onClose}>
          ← {L("Arena", "竞技场")}
        </button>
        <span className="ar-stat" aria-label={L(`${run.trophies} of ${TROPHIES_TO_WIN} trophies`, `${run.trophies}/${TROPHIES_TO_WIN} 座奖杯`)}>
          🏆 {run.trophies}/{TROPHIES_TO_WIN}
        </span>
        <span className="ar-stat" aria-label={L(`${run.hearts} hearts left`, `剩 ${run.hearts} 颗心`)}>
          {"❤".repeat(run.hearts)}
          <i>{"❤".repeat(Math.max(0, START_HEARTS - run.hearts))}</i>
        </span>
        <span className="ar-stat ar-coins" aria-label={L(`${run.coins} coins to spend`, `可花 ${run.coins} 金币`)}>
          ● {run.coins}
        </span>
      </div>
      <p className="label">{L(`Battle ${run.round + 1}: your line, front first`, `第 ${run.round + 1} 场：你的队伍，最前面先上`)}</p>
      <ol className="ar-line">
        <li className="ar-slot is-pet">
          <PetArt pet={pet} scale={3} />
          <b>{pet.name}</b>
          <span className="small ar-hp">{L("leads · 100 hp", "队长 · 100 体力")}</span>
        </li>
        {run.team.map((id, i) => {
          const c = COMPANION[id]!;
          return (
            <motion.li key={`${id}-${i}`} layout className="ar-slot">
              <CompanionArt id={id} scale={3} label={c.name[lang]} />
              <b title={c.role[lang]}>{c.name[lang]}</b>
              <span className="small ar-hp">{lang === "zh" ? `${c.hp} 体力` : `${c.hp} hp`}</span>
              <span className="ar-slot-acts">
                <button type="button" aria-label={L(`Move ${c.name.en} forward`, `把${c.name.zh}往前挪`)} disabled={i === 0} onClick={() => act(shift(run, i, -1))}>
                  ‹
                </button>

                <button type="button" aria-label={L(`Move ${c.name.en} back`, `把${c.name.zh}往后挪`)} disabled={i === run.team.length - 1} onClick={() => act(shift(run, i, 1))}>
                  ›
                </button>
                <button type="button" className="ar-sell" aria-label={L(`Sell ${c.name.en} for ${SELL_BACK} coin`, `卖掉${c.name.zh}，退 ${SELL_BACK} 金币`)} onClick={() => act(sell(run, i), "pop")}>
                  {L("Sell", "卖")}
                </button>
              </span>
            </motion.li>
          );
        })}
        {Array.from({ length: MAX_COMPANIONS - run.team.length }, (_, i) => (
          <li key={`empty-${i}`} className="ar-slot is-empty" aria-label={L("Empty place", "空位")}>
            <span>+</span>
          </li>
        ))}
      </ol>
      <p className="label">{L("Shop", "商店")}</p>
      <ul className="ar-shop">
        {run.shop.map((id, i) => {
          if (!id)
            return (
              <li key={`s${i}`} className="ar-offer is-empty">
                <span className="small">{L("Sold", "已买走")}</span>
              </li>
            );
          const c = COMPANION[id]!;
          const frozen = run.frozen[i];
          return (
            <li key={`s${i}-${id}`} className={`ar-offer${frozen ? " is-frozen" : ""}`}>
              <CompanionArt id={id} scale={3} label={c.name[lang]} />
              <b>{c.name[lang]}</b>
              <span className="small">{c.role[lang]}</span>
              <span className="small ar-hp">{L(`${c.hp} hp`, `${c.hp} 体力`)}</span>
              <button type="button" className="btn primary" disabled={run.coins < c.cost || run.team.length >= MAX_COMPANIONS} onClick={() => act(buy(run, i), "success")}>
                {L(`Buy · ${c.cost}`, `买 · ${c.cost}`)}
              </button>
              <button type="button" className="ar-freeze" aria-pressed={frozen} onClick={() => act(toggleFreeze(run, i))}>
                {frozen ? L("❄ Frozen", "❄ 已冻结") : L("Freeze", "冻结")}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="row ar-go">
        <button type="button" className="btn" disabled={run.coins < ROLL_COST} onClick={() => act(roll(run))}>
          {L(`Roll · ${ROLL_COST}`, `换一批 · ${ROLL_COST}`)}
        </button>
        <button type="button" className="btn primary" disabled={finding} onClick={() => void fight()}>
          {finding ? L("Finding a rival…", "正在找对手……") : L("Battle!", "开战！")}
        </button>
      </div>
      <p className="small ar-note" aria-live="polite">
        {note || L("Unspent coins don't carry over. Frozen offers stay for the next battle.", "没花完的金币不会留到下一场。冻结的商品会留到下一场。")}
      </p>
    </div>
  );
}

function TeamFight({ pet, mine, foe, edge, rival, units, result, round, onDone }: { pet: Pet; mine: string[]; foe: string[]; edge: number; rival?: DuelPet; units: { mine: TeamUnit[]; theirs: TeamUnit[] }; result: TeamResult; round: number; onDone: () => void }) {
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const reduce = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const finished = shown >= result.rounds.length;
  const r = shown > 0 ? result.rounds[shown - 1]! : null;
  const ids: [string[], string[]] = [["pet", ...mine], rival ? ["rival", ...foe] : foe];
  const isPet = (s: 0 | 1, u: number) => u === 0 && (s === 0 || !!rival);
  const maxHp = (s: 0 | 1, u: number) => (isPet(s, u) ? PET_HP : COMPANION[ids[s][u]!]!.hp);
  const hpOf = (s: 0 | 1, u: number) => (r ? r.hp[s][u]! : maxHp(s, u));
  const done = useRef(false);
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 700px)").matches;
  const big = wide ? 4 : 3;
  const small = wide ? 3 : 2;
  useEffect(() => {
    if (finished) return;
    const t = setTimeout(() => {
      const next = result.rounds[shown]!;
      play(next.hits[0] || next.hits[1] ? "pop" : "tap");
      setShown((n) => n + 1);
    }, shown === 0 ? 450 : reduce ? 380 : ROUND_MS);
    return () => clearTimeout(t);
  }, [shown, finished, result, reduce]);

  const face = (s: 0 | 1, u: number): Expression => {
    const hp = hpOf(s, u);
    if (hp <= 0) return "sleepy";
    if (finished) return result.winner === s ? "proud" : "sad";
    const m = r?.moves[s][u];
    if (r && u === r.fronts[s] && r.hits[s] >= 14) return "startled";
    if (m === "snack") return "munch";
    if (m === "charm" || m === "gift") return "love";
    if (m === "rest") return "sleepy";
    return "neutral";
  };

  const side = (s: 0 | 1) => (
    <div className={`ar-side side-${s}`}>
      {ids[s].map((id, u) => {
        const out = hpOf(s, u) <= 0;
        const front = r ? r.fronts[s] === u : u === 0;
        const m = r?.moves[s][u];
        const hit = r && front ? r.hits[s] : 0;
        return (
          <div key={`${id}-${u}`} className={`ar-unit${front ? " is-front" : ""}${out ? " is-out" : ""}`}>
            <span className="ar-mini-hp" role="meter" aria-valuemin={0} aria-valuemax={maxHp(s, u)} aria-valuenow={hpOf(s, u)} aria-label={L("health", "体力")}>
              <i style={{ transform: `scaleX(${hpOf(s, u) / maxHp(s, u)})` }} />
            </span>
            <motion.div key={`${u}-${shown}`} animate={hit && !reduce ? { x: [0, s === 0 ? -5 : 5, 0] } : m === "pounce" && front && !reduce ? { x: [0, s === 0 ? 10 : -10, 0] } : {}} transition={{ duration: 0.32 }}>
              {s === 0 && u === 0 ? (
                <PetArt pet={pet} scale={front ? big : small} face={face(0, 0)} />
              ) : s === 1 && u === 0 && rival ? (
                <RivalArt pet={rival} scale={front ? big : small} face={face(1, 0)} />
              ) : (
                <CompanionArt id={id} scale={front ? big : small} face={face(s, u)} />
              )}
            </motion.div>
            <AnimatePresence>
              {hit > 0 && (
                <motion.span key={`h${shown}`} className="sp-pop" initial={{ opacity: 0, y: 0 }} animate={{ opacity: 1, y: -14 }} exit={{ opacity: 0 }}>
                  −{hit}
                </motion.span>
              )}
            </AnimatePresence>
            <span className="ar-move">{out ? L("fainted", "晕倒了") : m ? MOVE[m][lang === "zh" ? 1 : 0] : "…"}</span>
          </div>
        );
      })}
    </div>
  );

  const title = result.winner === 0 ? L("Your team won!", "你的队伍赢了！") : result.winner === 1 ? L("Your team lost", "你的队伍输了") : L("A draw", "平手");
  return (
    <div className="ar-fight">
      <div className="sp-head">
        <span>{L(`Battle ${round + 1} · round ${Math.max(1, shown)}`, `第 ${round + 1} 场 · 第 ${Math.max(1, shown)} 回合`)}</span>
        <span className="small ar-foe">
          {rival ? L(`vs ${rival.name}'s team · a real player's line`, `对手：${rival.name}的队伍 · 真实玩家的阵容`) : edge > 0 ? L(`Ghost team, veterans (+${edge})`, `幽灵队伍，老练（+${edge}）`) : L("Ghost team", "幽灵队伍")}
        </span>
        {!finished && (
          <button type="button" className="link" onClick={() => setShown(result.rounds.length)}>
            {L("Skip to result", "跳到结果")}
          </button>
        )}
      </div>
      <div className="ar-ring" aria-live="polite">
        {side(0)}
        <span className="ar-vs" aria-hidden="true">VS</span>
        {side(1)}
      </div>
      <p className="small ar-explain">
        {L("Front units fight. Behind them, a gift heals the front, a charm weakens the enemy front, and pounces land at half strength.", "最前面的两个对打。后排送礼给队长回血，撒娇削弱对方队长，后排的扑击只有一半威力。")}
      </p>
      {finished && (
        <motion.div className="sp-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h3>{title}</h3>
          <p>{result.winner === 0 ? L("+1 trophy", "+1 座奖杯") : result.winner === 1 ? L("−1 heart", "−1 颗心") : L("No trophy, no heart lost.", "不加奖杯，也不丢心。")}</p>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (done.current) return;
                done.current = true;
                onDone();
              }}
            >
              {L("Continue", "继续")}
            </button>
          </div>
          <p className="small sp-fp">{L(`Replay ${result.digest} · seed ${result.seed}`, `回放指纹 ${result.digest} · 种子 ${result.seed}`)}</p>
          <ChainCheck
            pet={pet}
            rounds={result.rounds.filter((r) => r.words[0][0]! >= 0).length}
            run={(petId, onProgress) => checkTeamOnChain({ petId, mine: () => units.mine, theirs: () => units.theirs, result, onProgress })}
          />
        </motion.div>
      )}
    </div>
  );
}
