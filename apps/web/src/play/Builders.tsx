/**
 * Builders' Lane (PRD R2): five resident pets, each a fan tribute to someone who
 * builds TapeOut, standing in a room of its own. Tapping one opens its card.
 * Behemoth's card shows the founder's real 4-bit CPU running, lamp by lamp, and
 * lets anyone check the step on screen against BNB Chain.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createPublicClient, http, keccak256, parseAbi, type Hex } from "viem";
import { MARS, MINT, type Outfit, type Palette, SILICON, SKY, SUNNY, boundingBox, drawPet, paintOverlay, toRgba, wearOverlay } from "@lingxi/art";
import {
  BEHEMOTH_CIRCUIT,
  BEHEMOTH_NETLIST_KECCAK,
  BEHEMOTH_PINS,
  BEHEMOTH_PROCESSOR,
  BEHEMOTH_PROCESSOR_NAME,
  BEHEMOTH_STEP_MS,
  BUILDER_PETS,
  type BuilderId,
  type BuilderPet,
  LANE_PROJECTS,
  type Pet,
  behemothAt,
  behemothMoment,
  behemothStepNow,
  behemothTape,
  builderNow,
  composeProgram,
  daysSinceBehemoth,
  laneParty,
  stageOf,
  tapboyDay,
  meetTally,
} from "@lingxi/game";
import { ROOMS, outfitOf } from "@lingxi/world";
import { useLang } from "../i18n";
import { useBadges } from "../game/badges";
import { useWorld } from "../game/world";
import { play } from "../game/sound";
import { PALETTE_OF } from "../scene/textures";
import { Chips } from "./parts";
import { chipsFor } from "./ruleText";
import { Sprite } from "./Sprite";
import { noteEvent, noteTallies } from "../game/tally";
import { LaneQuests } from "./Quests";
import { LaneFriendship } from "./Neighbours";
import { saveWrite } from "../game/saveRuntime";
import { now as gameNow } from "../game/gameClock";

const PALETTES: Record<BuilderPet["look"]["palette"], Palette> = { silicon: SILICON, mars: MARS, sky: SKY, sunny: SUNNY, mint: MINT };
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
const BSC_RPC = "https://bsc-dataseed.bnbchain.org";
const KEY = "lingxi.builders.v1";

/** What a resident wears right now: Behemoth's lamps follow its CPU. */
export function builderOutfit(b: BuilderPet, ms: number): Outfit {
  return b.mind.kind === "cpu" ? { head: `b:lamps${behemothAt(behemothStepNow(ms)).acc}` } : b.look.outfit;
}

/** The resident of a room as the scene draws it. */
export function builderInScene(b: BuilderPet, lang: "en" | "zh", saidAt: number) {
  // its line and mood come from its own circuit (plan 4.11)
  const now = builderNow(b, gameNow(), new Date(gameNow()).getHours(), useBuilders.getState().met.includes(b.id));
  return {
    id: `builder:${b.id}`,
    name: b.name[lang],
    line: b.look.line,
    stage: b.look.stage,
    mood: now.mood,
    say: { text: now.line[lang], at: saidAt },
    look: { palette: { key: b.look.palette, colors: PALETTES[b.look.palette] }, outfitAt: (ms: number) => builderOutfit(b, ms), x: b.spot.x, lit: b.mind.kind === "cpu" },
  };
}

function loadMet(): BuilderId[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v.filter((x) => BUILDER_PETS.some((b) => b.id === x)) as BuilderId[]) : [];
  } catch {
    return [];
  }
}

export const useBuilders = create<{ met: BuilderId[]; meet: (id: BuilderId) => void }>((set, get) => ({
  met: loadMet(),
  meet: (id) => {
    if (get().met.includes(id)) return;
    const met = [...get().met, id];
    try {
      saveWrite(KEY, JSON.stringify(met));
    } catch {
      // kept for this visit
    }
    set({ met });
    useBadges.getState().note("builders", met.length);
  },
}));

function BuilderArt({ b, scale, ms }: { b: BuilderPet; scale: number; ms: number }) {
  // the pieces worn change with the hour (ms); the picture is redrawn only when one does
  const { head, face, held } = builderOutfit(b, ms);
  const { canvas, overlay, crop } = useMemo(() => {
    const c = drawPet(b.look.line, b.look.stage, { expression: "happy", lit: b.mind.kind === "cpu" });
    const o = wearOverlay(c, b.look.line, b.look.stage, { ...(head ? { head } : {}), ...(face ? { face } : {}), ...(held ? { held } : {}) }, 0);
    const box = boundingBox(c);
    const xs = [box.x, box.x + box.w - 1, ...o.map((p) => p[0])];
    const ys = [box.y, box.y + box.h - 1, ...o.map((p) => p[1])];
    const x0 = Math.max(0, Math.min(...xs) - 1);
    const y0 = Math.max(0, Math.min(...ys) - 1);
    return { canvas: c, overlay: o, crop: { x: x0, y: y0, w: Math.min(c.w, Math.max(...xs) + 2) - x0, h: Math.min(c.h, Math.max(...ys) + 2) - y0 } };
  }, [b, head, face, held]);
  return <Sprite canvas={canvas} palette={PALETTES[b.look.palette]} scale={scale} overlay={overlay} crop={crop} label={b.name.en} />;
}

/** Ticks while mounted, so the lamps follow the CPU. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => gameNow());
  useEffect(() => {
    const id = setInterval(() => setNow(gameNow()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

const packBits = (bits: readonly number[]): Hex => {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3]! |= 1 << (i & 7);
  });
  return `0x${Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("")}`;
};

const cpuAbi = parseAbi(["function step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)", "function netlist(uint256 id) view returns (bytes)"]);

/** Runs the step on screen on BNB Chain itself and compares both answers; also compares the whole circuit. */
async function checkOnBnb(step: number): Promise<"same" | "differs"> {
  const pub = createPublicClient({ transport: http(BSC_RPC) });
  const f = behemothAt(step);
  const next = behemothAt(step + 1);
  const [[newState, outputs], netlist] = await Promise.all([
    pub.readContract({ address: BEHEMOTH_PROCESSOR as Hex, abi: cpuAbi, functionName: "step", args: [BigInt(BEHEMOTH_CIRCUIT), packBits(f.state), "0x"] }),
    pub.readContract({ address: BEHEMOTH_PROCESSOR as Hex, abi: cpuAbi, functionName: "netlist", args: [BigInt(BEHEMOTH_CIRCUIT)] }),
  ]);
  const ok = newState.toLowerCase() === packBits(next.state) && outputs.toLowerCase() === packBits(f.outputs) && keccak256(netlist) === BEHEMOTH_NETLIST_KECCAK;
  return ok ? "same" : "differs";
}

function BehemothMind({ lang }: { lang: "en" | "zh" }) {
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const now = useNow(BEHEMOTH_STEP_MS / 3);
  const step = behemothStepNow(now);
  const f = behemothAt(step);
  const m = behemothMoment(step);
  const { frames, loopFrom } = behemothTape();
  const [check, setCheck] = useState<"idle" | "busy" | "same" | "differs" | "offline">("idle");
  const [checked, setChecked] = useState<number | null>(null);
  // watching the count reach 13, the biggest Fibonacci number its four lamps hold (once per visit)
  const sawThirteen = useRef(false);
  useEffect(() => {
    if (f.acc !== 13 || sawThirteen.current) return;
    sawThirteen.current = true;
    noteEvent("lane-count");
  }, [f.acc]);
  // say what the lamps show right now; the CPU's phase only decides the wording around it
  const said =
    m.kind === "boot"
      ? L("Starting up.", "正在启动。")
      : m.kind === "overflow"
        ? L("21 doesn't fit in four bits, so the count spills over. It will start again soon.", "21 装不进四个比特，于是数字溢出了。它马上会重新开始。")
        : f.acc === 13
          ? L("13! The biggest Fibonacci number four bits can hold.", "13！四个比特能装下的最大斐波那契数。")
          : L(`Counting up the Fibonacci numbers: its lamps show ${f.acc}.`, `正在数斐波那契数：它的灯显示 ${f.acc}。`);
  return (
    <div className="bh-mind">
      <div className="bh-lamps" role="img" aria-label={L(`The accumulator shows ${f.acc}`, `累加器显示 ${f.acc}`)}>
        {[3, 2, 1, 0].map((bit) => (
          <span key={bit} className={`bh-lamp${f.lamps[bit] ? " is-on" : ""}`}>
            <i>{1 << bit}</i>
          </span>
        ))}
        <b className="bh-num">{f.acc}</b>
      </div>
      <p className="bh-said" aria-live="off">
        {said}
      </p>
      <dl className="bh-facts">
        <dt>{L("Its mind", "它的心智")}</dt>
        <dd>
          {L(`circuit #${BEHEMOTH_CIRCUIT} on processor "${BEHEMOTH_PROCESSOR_NAME}", BNB Chain`, `BNB Chain 上处理器“${BEHEMOTH_PROCESSOR_NAME}”的 #${BEHEMOTH_CIRCUIT} 号电路`)}{" "}
          <a href={`https://bscscan.com/address/${BEHEMOTH_PROCESSOR}`} target="_blank" rel="noopener noreferrer">
            {BEHEMOTH_PROCESSOR.slice(0, 6)}…{BEHEMOTH_PROCESSOR.slice(-4)}
          </a>
        </dd>
        <dt>{L("Size", "大小")}</dt>
        <dd>{L(`${BEHEMOTH_PINS.gates} gates, ${BEHEMOTH_PINS.nState} memory bits, no inputs`, `${BEHEMOTH_PINS.gates} 个门，${BEHEMOTH_PINS.nState} 位记忆，没有输入`)}</dd>
        <dt>{L("Right now", "此刻")}</dt>
        <dd>{L(`step ${(step - loopFrom) % (frames.length - loopFrom)} of ${frames.length - loopFrom}, program counter ${f.pc}`, `一轮 ${frames.length - loopFrom} 步里的第 ${(step - loopFrom) % (frames.length - loopFrom)} 步，程序计数器 ${f.pc}`)}</dd>
      </dl>
      <button
        type="button"
        className="btn"
        disabled={check === "busy"}
        onClick={async () => {
          play("tap");
          setCheck("busy");
          const at = behemothStepNow(gameNow());
          try {
            const r = await checkOnBnb(at);
            if (r === "same") noteEvent("lane-checked");
            setChecked(at);
            setCheck(r);
            play(r === "same" ? "success" : "error");
          } catch {
            setCheck("offline");
          }
        }}
      >
        {check === "busy" ? L("Asking BNB Chain…", "正在问 BNB Chain……") : L("Check this step on BNB Chain", "在 BNB Chain 上核对这一步")}
      </button>
      {check === "same" && checked !== null && (
        <p className="small bh-ok" role="status">
          {L(
            `BNB Chain ran the same step and gave the same lamps (${behemothAt(checked).acc}) and the same next memory. The circuit here is the chain's, byte for byte.`,
            `BNB Chain 运行了同一步，得到同样的灯（${behemothAt(checked).acc}）和同样的下一份记忆。这里的电路和链上的逐字节一致。`,
          )}
        </p>
      )}
      {check === "differs" && (
        <p className="small sp-warn" role="status">
          {L("BNB Chain gave a different answer. Trust the chain, not this page.", "BNB Chain 给出了不同的答案。请相信链，而不是这个页面。")}
        </p>
      )}
      {check === "offline" && (
        <p className="small" role="status">
          {L("BNB Chain couldn't be reached. Try again in a moment.", "暂时连不上 BNB Chain，过一会儿再试。")}
        </p>
      )}
    </div>
  );
}

/** Mars's count: circuits taped out on X Layer today, from the server's running tally of every processor. */
function TapeoutsToday({ lang }: { lang: "en" | "zh" }) {
  // with no server to ask, there is no count to show
  const [v, setV] = useState<{ today: number; total: number; processors: number; since: string } | null | "none">(API ? null : "none");
  useEffect(() => {
    if (!API) return;
    let live = true;
    fetch(`${API}/api/lane/tapeouts`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json())
      .then((j: { ok: boolean; today: number; total: number; processors: number; since: string }) => live && setV(j.ok ? j : "none"))
      .catch(() => live && setV("none"));
    return () => {
      live = false;
    };
  }, []);
  if (v === "none") return null;
  return (
    <p className="bh-said">
      {v === null
        ? lang === "zh"
          ? "正在数今天的电路……"
          : "Counting today's circuits…"
        : lang === "zh"
          ? `今天 X Layer 上已经流片了 ${v.today} 块电路（共 ${v.total} 块，${v.processors} 台处理器；从 ${v.since} UTC 数起）。`
          : `${v.today} ${v.today === 1 ? "circuit has" : "circuits have"} been taped out on X Layer today (${v.total} in all, on ${v.processors} processors; counted since ${v.since} UTC).`}
    </p>
  );
}

function Lanterns({ lang }: { lang: "en" | "zh" }) {
  return (
    <div className="lanterns">
      <p className="label">{lang === "zh" ? `小巷的灯笼 · 每位建设者一盏（${LANE_PROJECTS.length}）` : `Lanterns of the lane · one for every builder (${LANE_PROJECTS.length})`}</p>
      <p className="small">{lang === "zh" ? "这些是 X Layer × TapeOut 开发者排行榜上的作品。点一盏灯，去看看它。" : "These are the projects on the X Layer × TapeOut developer leaderboard. Tap a lantern to visit one."}</p>
      <ul>
        {LANE_PROJECTS.map((p, i) => (
          <li key={p.name} style={{ animationDelay: `${(i % 7) * -0.4}s` }}>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.name}
              </a>
            ) : (
              <span>{p.name}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A picture of the player's pet beside the resident, in the resident's room, to save or share. */
async function postcard(pet: Pet, b: BuilderPet, lang: "en" | "zh"): Promise<Blob> {
  const S = 4;
  const el = document.createElement("canvas");
  el.width = 128 * S;
  el.height = 128 * S + 56;
  const ctx = el.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const bg = new Image();
  bg.src = (ROOMS[b.room] ?? ROOMS[0]!).bgs.day;
  await bg.decode();
  ctx.drawImage(bg, 0, 0, 128 * S, 128 * S);
  const put = (line: Pet["line"], stage: "baby" | "child" | "teen" | "adult", palette: Palette, outfit: Outfit, cx: number, feet: number, flip: boolean, form?: Pet["form"]) => {
    const c = drawPet(line, stage, { expression: "happy", ...(form ? { form } : {}) });
    const rgba = toRgba(c, palette, 1);
    paintOverlay(rgba, c.w, wearOverlay(c, line, stage, outfit, 0, form));
    const tmp = document.createElement("canvas");
    tmp.width = c.w;
    tmp.height = c.h;
    tmp.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), c.w, c.h), 0, 0);
    ctx.save();
    ctx.translate(cx * S, 0);
    ctx.scale(flip ? -1 : 1, 1);
    ctx.drawImage(tmp, (-c.w / 2) * S, (feet - 45) * S, c.w * S, c.h * S);
    ctx.restore();
  };
  const st = stageOf(pet, gameNow());
  const mine = (st === "elder" ? "adult" : st) as "baby" | "child" | "teen" | "adult";
  put(b.look.line, b.look.stage, PALETTES[b.look.palette], builderOutfit(b, gameNow()), 82, 112, true);
  put(pet.line, mine, PALETTE_OF[pet.line], outfitOf(useWorld.getState().world, String(pet.bornAt)) as Outfit, 44, 112, false, pet.form);
  ctx.fillStyle = "#2B2140";
  ctx.fillRect(0, 128 * S, el.width, 56);
  ctx.fillStyle = "#FFF7E8";
  ctx.font = "800 22px 'Baloo 2 Variable', system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(lang === "zh" ? `${pet.name}见到了${b.name.zh}` : `${pet.name} met ${b.name.en}`, 16, 128 * S + 20);
  ctx.font = "600 14px 'Baloo 2 Variable', system-ui, sans-serif";
  ctx.fillStyle = "#FFC83D";
  ctx.fillText(lang === "zh" ? "灵犀 · 建设者小巷 · lingxi.knole.me" : "Lingxi · Builders' Lane · lingxi.knole.me", 16, 128 * S + 42);
  return new Promise((done, fail) => el.toBlob((x) => (x ? done(x) : fail(new Error("no image"))), "image/png"));
}

export function BuilderCard({ b, pet, onSpar }: { b: BuilderPet; pet: Pet; onSpar: () => void }) {
  const lang = useLang((s) => s.lang) as "en" | "zh";
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const now = useNow(b.mind.kind === "cpu" ? BEHEMOTH_STEP_MS : 30_000);
  const { met, meet } = useBuilders();
  const [card, setCard] = useState<string | null>(null);
  const party = laneParty(new Date(now));
  useEffect(() => {
    meet(b.id);
    // every visit counts for quests, and so does each day you came by
    noteTallies(meetTally(b.id, gameNow(), -new Date(gameNow()).getTimezoneOffset()));
    if (party) {
      const k = `lingxi.laneparty.${party}`;
      try {
        if (!localStorage.getItem(k)) {
          saveWrite(k, "1");
          useBadges.getState().note("laneParty");
        }
      } catch {
        // the party still shows; only the badge is missed
      }
    }
  }, [b.id, meet, party]);
  useEffect(
    () => () => {
      if (card) URL.revokeObjectURL(card);
    },
    [card],
  );
  const program = b.mind.kind === "pet" ? composeProgram(b.look.line, b.mind.lessons) : null;
  const line = builderNow(b, now, new Date(now).getHours(), true).line;
  return (
    <div className="builder-card">
      {party && (
        <p className="lane-party" role="status">
          {L(`Day ${party} since Behemoth first ran. The lane is celebrating: the candles on the cake below are lit by its own lamps.`, `巨兽第一次运行后的第 ${party} 天。小巷在庆祝：下面蛋糕上的蜡烛，是它自己的灯点亮的。`)}
        </p>
      )}
      <div className="builder-head">
        <span className="builder-art">
          <BuilderArt b={b} scale={4} ms={now} />
        </span>
        <div>
          <p className="builder-say">“{line[lang]}”</p>
          <p className="small">{b.about[lang]}</p>
        </div>
      </div>
      <LaneQuests id={b.id} />
      <LaneFriendship id={b.id} />
      {party && (
        <div className="lane-cake" role="img" aria-label={L("A cake with four candles", "一个插着四根蜡烛的蛋糕")}>
          {[3, 2, 1, 0].map((bit) => (
            <span key={bit} className={`candle${behemothAt(behemothStepNow(now)).lamps[bit] ? " is-lit" : ""}`} />
          ))}
        </div>
      )}
      {b.mind.kind === "cpu" ? (
        <BehemothMind lang={lang} />
      ) : (
        <div className="builder-rules">
          <p className="label">{L("What it was taught", "它学过的")}</p>
          {b.mind.lessons.map((r) => {
            const c = chipsFor(program!, r, lang);
            return (
              <div key={r.label} className="rule-preview">
                <Chips when={c.when} then={c.then} want={c.want} />
              </div>
            );
          })}
          <p className="small">{L(`A Lingxi pet of the ${b.look.line} line with these lessons on top of what it hatched knowing.`, `一只${{ gentle: "温柔", bold: "勇敢", curious: "好奇" }[b.look.line]}系的灵犀宠物，在天生会的东西之上学了这几课。`)}</p>
        </div>
      )}
      {b.id === "mars" && <TapeoutsToday lang={lang} />}
      {b.id === "tapboy" && <p className="bh-said">{L(`GMGM. Day ${tapboyDay(new Date(now))} of 1000.`, `GMGM。第 ${tapboyDay(new Date(now))}/1000 天。`)}</p>}
      {b.id === "behemoth" && <p className="small">{L(`Day ${daysSinceBehemoth(new Date(now))} since it first ran, on 15 August 2026.`, `从 2026 年 8 月 15 日第一次运行算起，今天是第 ${daysSinceBehemoth(new Date(now))} 天。`)}</p>}
      <div className="builder-actions">
        {b.mind.kind === "cpu" && (
          <button type="button" className="btn primary" onClick={() => (play("tap"), onSpar())}>
            {L("Spar Behemoth", "和巨兽切磋")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={async () => {
            play("tap");
            try {
              const blob = await postcard(pet, b, lang);
              setCard(URL.createObjectURL(blob));
              play("success");
            } catch {
              play("error");
            }
          }}
        >
          {L("Make a postcard", "做一张明信片")}
        </button>
      </div>
      {card && (
        <figure className="builder-postcard">
          <img src={card} alt={L(`${pet.name} with ${b.name.en}`, `${pet.name}和${b.name.zh}`)} />
          <a className="btn" href={card} download={`lingxi-${b.id}.png`}>
            {L("Save the picture", "保存图片")}
          </a>
        </figure>
      )}
      <p className="small builder-tribute">
        {L(`A fan tribute to @${b.tribute.handle}: ${b.tribute.as.en}. Not affiliated with or endorsed by them.`, `向 @${b.tribute.handle} 致敬：${b.tribute.as.zh}。与本人无关，也未经其背书。`)}
      </p>
      <p className="small">{L(`Builders' Lane · met ${met.length} of ${BUILDER_PETS.length}`, `建设者小巷 · 已见到 ${met.length} / ${BUILDER_PETS.length}`)}</p>
      <ul className="lane-map">
        {BUILDER_PETS.map((o) => (
          <li key={o.id} className={met.includes(o.id) ? "is-met" : ""}>
            <b>{met.includes(o.id) ? o.name[lang] : "???"}</b>
            <span className="small">{(ROOMS[o.room] ?? ROOMS[0]!).name[lang]}</span>
          </li>
        ))}
      </ul>
      {b.id === "behemoth" && <Lanterns lang={lang} />}
    </div>
  );
}
