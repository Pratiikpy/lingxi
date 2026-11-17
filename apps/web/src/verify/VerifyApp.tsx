/**
 * The proof page. Anyone can check a Lingxi pet without trusting us:
 *   1. read the pet straight from PetRegistry on X Layer;
 *   2. download its brain's netlist from the TapeOut processor and run it in our
 *      open TAP-02 evaluator, side by side with the processor's own `step`;
 *   3. drop in a pet's input log to recompute the keccak hash chain the last
 *      checkpoint committed to, and replay every beat to the memory on chain.
 */

import { OnChainNote } from "../OnChainNote";
import { ProofTable } from "./ProofTable";
import { RuleTable } from "./RuleTable";
import { ContractTable } from "./ContractTable";
import { useCallback, useEffect, useRef, useState } from "react";
import { type Hex } from "viem";
import { beat, bitsToWord, circuitBrain, hexToBytes, load, type Circuit, wordToBits, decodeSenses } from "@lingxi/brain";
import { PetHistory } from "./History";
import { type ChainPet, canvasOfSvg, gameSprite, loadCircuitFromChain, lookOf, readMetadata, readPet, replayMany, replayStep } from "@lingxi/chain";
import { type DiaryLine, chainAll, diaryOfStretches, diaryText, unpackState, ZERO_HASH } from "@lingxi/game";

const DIARY_API = (import.meta.env.VITE_API_URL as string | undefined) ?? (location.hostname === "localhost" ? "http://localhost:8787" : "");
import { deployment, publicClient, readClients } from "../game/chain";
import { useLang } from "../i18n";
import "./verify.css";
import { markProofChecked } from "../game/proofMark";

interface Row {
  state: bigint;
  word: number;
  chain: { next: bigint; outputs: number };
  local: { next: bigint; outputs: number };
}

const T = {
  en: {
    title: "Verify a Lingxi pet",
    lede: "Every Lingxi pet's mind is a TapeOut circuit on X Layer. This page reads the chain directly and checks the pet's thoughts with an open evaluator, so you never have to trust the game.",
    id: "Pet number",
    load: "Read from X Layer",
    owner: "Owner",
    brain: "Brain circuit",
    gates: "gates",
    memory: "memory bits",
    days: "Days saved",
    log: "Committed input log",
    meters: "Saved state",
    run: "Check 32 thoughts",
    running: "Asking the processor...",
    match: "match",
    differ: "differ",
    allOk: "All {n} thoughts match: the processor on X Layer and the open evaluator give identical memory and outputs.",
    someBad: "{n} thoughts differ. Report this; it should never happen.",
    logTitle: "Check a day's log",
    logPick: "Choose a log file",
    logNone: "No file chosen",
    logHelp: "Drop the log file the game exports (Pet → Download log). We recompute its hash chain and replay every beat.",
    logOk: "The log's hash equals the one on chain, and replaying its {n} gives exactly the saved memory.",
    logBadHash: "This log does not hash to the value on chain.",
    logBadState: "The hash matches, but the replay ends at a different memory than the one saved.",
    notFound: "No pet with that number.",
    picture: "Its picture, drawn on chain",
    pictureNote: "PetLook draws this from the pet's saved state: its stage, its mood and whether its circuit glows. This page only shows what the chain returns.",
    pictureSame: "Pixel for pixel the game's own art for this state.",
    pictureDiff: "This picture differs from the game's art for this state.",
    named: "Name on chain",
    notDeployed: "This build is not connected to a deployment.",
    want: "want",
    inputs: "inputs",
    state: "memory",
  },
  zh: {
    title: "验证一只灵犀宠物",
    lede: "每只灵犀宠物的心智都是 X Layer 上的 TapeOut 电路。本页直接读取链上数据，用开源求值器核对它的念头，你不需要相信游戏本身。",
    id: "宠物编号",
    load: "从 X Layer 读取",
    owner: "主人",
    brain: "大脑电路",
    gates: "个门",
    memory: "位记忆",
    days: "已保存天数",
    log: "已承诺的输入日志",
    meters: "保存的状态",
    run: "核对 32 个念头",
    running: "正在询问处理器……",
    match: "一致",
    differ: "不一致",
    allOk: "{n} 个念头全部一致：X Layer 上的处理器和开源求值器给出完全相同的记忆和输出。",
    someBad: "有 {n} 个念头不一致。请报告，这不应该发生。",
    logTitle: "核对某一天的日志",
    logPick: "选择日志文件",
    logNone: "还没有选择文件",
    logHelp: "拖入游戏导出的日志文件（宠物 → 下载日志）。我们会重算哈希链并重放每一拍。",
    logOk: "日志哈希与链上一致，重放 {n} 拍后得到的记忆与保存的完全相同。",
    logBadHash: "这份日志的哈希和链上的不一致。",
    logBadState: "哈希一致，但重放后的记忆与保存的不同。",
    notFound: "没有这个编号的宠物。",
    picture: "它的样子，由链上绘制",
    pictureNote: "PetLook 根据宠物保存的状态画出这张图：成长阶段、心情，以及电路有没有亮。本页只是显示链上返回的结果。",
    pictureSame: "与游戏里这个状态的画面逐像素一致。",
    pictureDiff: "这张图和游戏里这个状态的画面不一致。",
    named: "链上名字",
    notDeployed: "这个版本没有连接到部署。",
    want: "想要",
    inputs: "输入",
    state: "记忆",
  },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function VerifyApp() {
  const { lang, toggle } = useLang();
  const t = T[lang];
  const [id, setId] = useState(() => location.hash.replace("#", "") || "1");
  const [pet, setPet] = useState<ChainPet | null>(null);
  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [gates, setGates] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [logResult, setLogResult] = useState<string | null>(null);
  const [logName, setLogName] = useState<string | null>(null);
  // the exhaustive check: every one of the 65,536 inputs at the pet's saved memory
  const [all, setAll] = useState<{ done: number; bad: number; first?: string; secs?: number; stopped?: boolean } | null>(null);
  const stopAll = useRef(false);
  // the picture and name the registry serves for this pet, drawn by PetLook
  const [meta, setMeta] = useState<{ name: string; image?: string; same?: boolean } | null>(null);

  const read = useCallback(async () => {
    setErr(null);
    setRows([]);
    setLogResult(null);
    if (!deployment) return setErr(t.notDeployed);
    try {
      const p = await readPet(publicClient, deployment, BigInt(id));
      setPet(p);
      setMeta(null);
      void readMetadata(publicClient, deployment, BigInt(id))
        .then((m) => {
          const svg = m.image?.startsWith("data:image/svg+xml;base64,") ? atob(m.image.slice(26)) : null;
          setMeta({ name: m.name, image: m.image, same: svg ? JSON.stringify(canvasOfSvg(svg).px) === JSON.stringify(gameSprite(lookOf(p.state)).px) : undefined });
        })
        .catch(() => setMeta(null));
      // a child's circuit REFs its parents' circuits; those are read from the chain too
      const c = await loadCircuitFromChain(publicClient, p.processor, p.brainId);
      setCircuit(c);
      setGates(c.nGates);
      history.replaceState(null, "", `#${id}`);
    } catch {
      setPet(null);
      setErr(t.notFound);
    }
  }, [id, t]);

  useEffect(() => {
    void read();
    // read once on open; later reads are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // following a family link (or editing the address) opens that pet
  const [follow, setFollow] = useState(false);
  useEffect(() => {
    const on = () => {
      const h = location.hash.replace("#", "");
      if (/^\d{1,10}$/.test(h)) {
        setId(h);
        setFollow(true);
      }
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    if (!follow) return;
    setFollow(false);
    void read();
  }, [follow, read]);

  const run = async () => {
    if (!pet || !circuit || !deployment) return;
    setRunning(true);
    const out: Row[] = [];
    const bits = pet.brainBits;
    const saved = unpackState(pet.state, bits).brain;
    for (let i = 0; i < 32; i++) {
      const state = i === 0 ? bitsToWord(saved) : BigInt(Math.floor(Math.random() * 2 ** Math.min(bits, 30)));
      const word = Math.floor(Math.random() * 65536);
      const chain = await replayStep(publicClient, deployment, pet.id, state, word);
      const [ns, outs] = beat(circuit, wordToBits(state, bits), wordToBits(word, 16));
      out.push({ state, word, chain, local: { next: bitsToWord(ns), outputs: Number(bitsToWord(outs)) } });
      setRows([...out]);
    }
    if (out.every((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs)) markProofChecked();
    setRunning(false);
  };

  const runAll = async () => {
    if (!pet || !circuit || !deployment) return;
    stopAll.current = false;
    const t0 = performance.now();
    const bits = pet.brainBits;
    const saved = unpackState(pet.state, bits).brain;
    const state = bitsToWord(saved);
    const BATCH = 64;
    let next = 0;
    let done = 0;
    let bad = 0;
    let first: string | undefined;
    setAll({ done: 0, bad: 0 });
    // two workers per official endpoint, gently paced, so neither rate-limits the page
    const worker = async (client: typeof publicClient) => {
      while (next < 65536 && !stopAll.current) {
        const from = next;
        next += BATCH;
        const words = Array.from({ length: Math.min(BATCH, 65536 - from) }, (_, k) => from + k);
        let chain: Array<{ next: bigint; outputs: number }> = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            chain = await replayMany(client, deployment!, pet.id, state, words);
            await new Promise((r) => setTimeout(r, 120));
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          }
        }
        words.forEach((w, k) => {
          const [ns, outs] = beat(circuit, saved, wordToBits(w, 16));
          const c = chain[k];
          if (!c || c.next !== bitsToWord(ns) || c.outputs !== Number(bitsToWord(outs))) {
            bad++;
            first ??= `0x${w.toString(16).padStart(4, "0")}`;
          }
        });
        done += words.length;
        setAll({ done, bad, ...(first ? { first } : {}) });
      }
    };
    await Promise.all([0, 1, 2, 3].map((i) => worker(readClients[i % readClients.length]!)));
    setAll({ done, bad, ...(first ? { first } : {}), secs: Math.round((performance.now() - t0) / 1000), stopped: stopAll.current });
  };

  const onLog = async (file: File) => {
    try {
      await replayLog(JSON.parse(await file.text()));
    } catch {
      setLogResult(t.logBadHash);
    }
  };

  /** Replays a log against the brains read from the chain; returns the stretches when it matches the saved state. */
  const replayLog = async (j: { words: number[]; segments?: Array<{ brainId: string | null; words: number[] }> }): Promise<Array<{ brain: { fast: ReturnType<typeof circuitBrain>; nState: number }; words: number[] }> | null> => {
    if (!pet || !circuit) return null;
    try {
      const clean = (ws: number[]) => ws.filter((w) => Number.isInteger(w) && w >= 0 && w < 65536);
      const segments = j.segments?.length ? j.segments.map((sg) => ({ brainId: sg.brainId, words: clean(sg.words) })) : [{ brainId: pet.brainId.toString(), words: clean(j.words) }];
      const words = segments.flatMap((sg) => sg.words);
      if (chainAll(ZERO_HASH, words).toLowerCase() !== pet.logHash.toLowerCase()) {
        setLogResult(t.logBadHash);
        return null;
      }
      const stretches: Array<{ brain: { fast: ReturnType<typeof circuitBrain>; nState: number }; words: number[] }> = [];
      // each stretch of the log runs on the brain it was recorded with, read from the processor
      let st = new Array<number>(pet.brainBits).fill(0);
      for (const sg of segments) {
        if (!sg.words.length) continue;
        const id = BigInt(sg.brainId ?? pet.brainId.toString());
        const c = await loadCircuitFromChain(publicClient, pet.processor, id);
        if (st.length !== c.nState) st = st.slice(0, c.nState).concat(new Array(Math.max(0, c.nState - st.length)).fill(0));
        for (const w of sg.words) st = beat(c, st, wordToBits(w, 16))[0];
        stretches.push({ brain: { fast: circuitBrain(c), nState: c.nState }, words: sg.words });
      }
      const saved = unpackState(pet.state, pet.brainBits).brain;
      const beats = lang === "zh" ? String(words.length) : `${words.length} ${words.length === 1 ? "beat" : "beats"}`;
      const same = st.join("") === saved.join("");
      setLogResult(same ? t.logOk.replace("{n}", beats) : t.logBadState);
      return same ? stretches : null;
    } catch {
      setLogResult(t.logBadHash);
      return null;
    }
  };

  // Z1: the diary its owner published, checked here against the chain before a word of it is shown
  const [diary, setDiary] = useState<DiaryLine[] | null>(null);
  const [diaryState, setDiaryState] = useState<"none" | "checking" | "ok" | "bad">("none");
  useEffect(() => {
    setDiary(null);
    setDiaryState("none");
    if (!pet || !circuit || !DIARY_API) return;
    let live = true;
    void (async () => {
      try {
        const r = (await (await fetch(`${DIARY_API}/api/pets/${pet.id}/log`)).json()) as { ok: boolean; log?: { words: number[]; segments: Array<{ brainId: string | null; words: number[] }> } };
        if (!live || !r.ok || !r.log) return;
        setDiaryState("checking");
        const stretches = await replayLog(r.log);
        if (!live) return;
        if (!stretches) return setDiaryState("bad");
        setDiary(diaryOfStretches(stretches.map((x) => ({ brain: { fast: x.brain.fast as never, nState: x.brain.nState }, words: x.words }))));
        setDiaryState("ok");
      } catch {
        // no published diary: nothing to show
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pet?.id, pet?.logHash, circuit]);

  const ok = rows.filter((r) => r.chain.next === r.local.next && r.chain.outputs === r.local.outputs).length;
  const u = pet ? unpackState(pet.state, pet.brainBits) : null;
  return (
    <main className="verify">
      <header className="v-head">
        <a href="play.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{t.title}</h1>
      <p className="v-lede">{t.lede}</p>
      <form
        className="v-form"
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
      >
        <label htmlFor="pet-id">{t.id}</label>
        <input id="pet-id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, "").slice(0, 10))} />
        <button type="submit">{t.load}</button>
      </form>
      {err && <p className="v-err">{err}</p>}
      {pet && u && (
        <section className="v-card" aria-label={t.brain}>
          {meta?.image && (
            <figure className="v-picture">
              <img src={meta.image} alt={meta.name} width={144} height={144} />
              <figcaption>
                <b>{meta.name}</b>
                <span className="v-note">{t.pictureNote}</span>
                {meta.same !== undefined && <span className={meta.same ? "v-ok" : "v-bad"}>{meta.same ? t.pictureSame : t.pictureDiff}</span>}
              </figcaption>
            </figure>
          )}
          <dl>
            <dt>{t.owner}</dt>
            <dd className="mono">{short(pet.owner)}</dd>
            <dt>{t.brain}</dt>
            <dd className="mono">
              {short(pet.processor)} · #{pet.brainId.toString()} · {gates} {t.gates} · {pet.brainBits} {t.memory}
            </dd>
            <dt>{t.days}</dt>
            <dd>{pet.day}</dd>
            <dt>{t.log}</dt>
            <dd className="mono">{short(pet.logHash)}</dd>
            <dt>{t.meters}</dt>
            <dd>
              {lang === "zh"
                ? `饱腹 ${u.meters.food} · 开心 ${u.meters.joy} · 精神 ${u.meters.energy} · 干净 ${u.meters.clean} · 经验 ${u.xp}`
                : `food ${u.meters.food} · joy ${u.meters.joy} · energy ${u.meters.energy} · clean ${u.meters.clean} · xp ${u.xp}`}
            </dd>
          </dl>
          <button type="button" className="v-run" onClick={run} disabled={running || !circuit}>
            {running ? t.running : t.run}
          </button>
          <div className="v-all">
            <p className="v-note">
              {lang === "zh"
                ? "或者问遍全部：在它保存的记忆下，把 65,536 种可能的感受全部交给 X Layer 上的处理器，再逐一和开源求值器比对（约 2–3 分钟）。"
                : "Or ask everything: at its saved memory, every one of the 65,536 possible inputs goes to the processor on X Layer and is compared with the open evaluator (about 2–3 minutes)."}
            </p>
            {all && !all.secs && !all.stopped ? (
              <>
                <div className="v-progress" role="progressbar" aria-valuemin={0} aria-valuemax={65536} aria-valuenow={all.done}>
                  <i style={{ transform: `scaleX(${all.done / 65536})` }} />
                </div>
                <p className="v-note">
                  {all.done.toLocaleString()} / 65,536 {all.bad ? (lang === "zh" ? `· ${all.bad} 处不一致` : `· ${all.bad} differ`) : ""}{" "}
                  <button type="button" className="v-link" onClick={() => (stopAll.current = true)}>
                    {lang === "zh" ? "停止" : "Stop"}
                  </button>
                </p>
              </>
            ) : (
              <button type="button" className="v-run" onClick={runAll} disabled={!circuit || running}>
                {lang === "zh" ? "问遍全部 65,536 种输入" : "Ask all 65,536 inputs"}
              </button>
            )}
            {all?.secs !== undefined && (
              <p className={all.bad === 0 && !all.stopped ? "v-ok" : "v-bad"}>
                {all.stopped
                  ? lang === "zh"
                    ? `已停止：核对了 ${all.done.toLocaleString()} 种，${all.bad} 处不一致。`
                    : `Stopped: ${all.done.toLocaleString()} checked, ${all.bad} differ.`
                  : all.bad === 0
                    ? lang === "zh"
                      ? `65,536 种输入全部一致（${all.secs} 秒）。在这份记忆下，它每一个可能的念头都和链上处理器相同。`
                      : `All 65,536 inputs match (${all.secs}s). At this memory, every thought it could possibly have is the processor's own.`
                    : lang === "zh"
                      ? `${all.bad} 种输入不一致，第一个是 ${all.first}。`
                      : `${all.bad} inputs differ, the first at ${all.first}.`}
              </p>
            )}
          </div>
          {rows.length > 0 && (
            <>
              <p className={ok === rows.length ? "v-ok" : "v-bad"}>{ok === rows.length ? t.allOk.replace("{n}", String(rows.length)) : t.someBad.replace("{n}", String(rows.length - ok))}</p>
              <div className="v-table" role="region" aria-label="beats" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t.state}</th>
                      <th>{t.inputs}</th>
                      <th>X Layer</th>
                      <th>{lang === "zh" ? "开源求值器" : "open evaluator"}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const same = r.chain.next === r.local.next && r.chain.outputs === r.local.outputs;
                      const s = decodeSenses(r.word);
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td className="mono">{r.state.toString(2).padStart(pet.brainBits, "0")}</td>
                          <td className="mono" title={JSON.stringify(s)}>
                            0x{r.word.toString(16).padStart(4, "0")}
                          </td>
                          <td className="mono">
                            {r.chain.next.toString(2).padStart(pet.brainBits, "0")} / {r.chain.outputs}
                          </td>
                          <td className="mono">
                            {r.local.next.toString(2).padStart(pet.brainBits, "0")} / {r.local.outputs}
                          </td>
                          <td className={same ? "v-ok" : "v-bad"}>{same ? t.match : t.differ}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {diaryState !== "none" && (
            <div className="v-diary">
              <p className="v-sub">{lang === "zh" ? "它的日记" : "Its diary"}</p>
              {diaryState === "checking" && <p className="v-note">{lang === "zh" ? "正在对照链上核对它的日记……" : "Checking its diary against the chain…"}</p>}
              {diaryState === "bad" && <p className="v-bad">{lang === "zh" ? "发布的日记和链上保存的对不上，所以不显示。" : "The published diary doesn't match what is saved on chain, so it isn't shown."}</p>}
              {diaryState === "ok" && diary && (
                <>
                  <p className="v-note">{lang === "zh" ? "最近一天，从链上读回的大脑重放每一刻得来，并与链上保存的状态一致。" : "Its latest day, replayed moment by moment through the brains read from the chain, and matching the state saved on chain."}</p>
                  <ul>
                    {diary.map((l, i) => (
                      <li key={i}>{diaryText(l, lang)}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <PetHistory
            id={pet.id.toString()}
            brainBits={pet.brainBits}
            lang={lang}
            onOpen={(other) => {
              location.hash = other;
            }}
          />
          <div className="v-log">
            <p className="v-sub">{t.logTitle}</p>
            <p className="v-lede">{t.logHelp}</p>
            <div className="v-file">
              <label className="v-run v-pick">
                {t.logPick}
                <input
                  type="file"
                  accept="application/json"
                  className="v-file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setLogName(f?.name ?? null);
                    if (f) void onLog(f);
                  }}
                />
              </label>
              <span className="v-note mono">{logName ?? t.logNone}</span>
            </div>
            {logResult && <p className={logResult === t.logBadHash || logResult === t.logBadState ? "v-bad" : "v-ok"}>{logResult}</p>}
          </div>
        </section>
      )}
      <ProofTable lang={lang} />
      <RuleTable lang={lang} />
      <ContractTable lang={lang} />
      <p className="v-note">
        <a href="numbers.html">{lang === "zh" ? "链上数字：宠物、交易和销毁的 BEM，全部读自合约" : "Live numbers: pets, sales and BEM burned, all read from the contracts"}</a>
      </p>
      <div className="v-note-wrap">
        <OnChainNote lang={lang} />
      </div>
    </main>
  );
}

export type { Hex };
